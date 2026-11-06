'use client';

import { Canvas } from '@react-three/fiber';
import { useConvex, useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useEffect, useRef, useState } from 'react';
import { api } from '../convex/_generated/api';
import { errorMessage } from '../lib/guest';
import { strings } from '../lib/strings';
import { GameHud } from './hud/GameHud';
import { createDesktopInput, type InputSource } from './input/input';
import { Button, ErrorText } from './lobby/ui';
import { NetworkMatch, type MatchTransport } from './match/networkMatch';
import { GameScene, type FrameStats } from './scene/GameScene';

type GameState = NonNullable<FunctionReturnType<typeof api.game.state>>;

export default function NetworkGame({ token, code }: { token: string; code: string }) {
  const state = useQuery(api.game.state, { token, code });
  if (!state) {
    return <div className="flex min-h-screen items-center justify-center bg-sky-300">{strings.loading}</div>;
  }
  return <Stage key={state.gameId} token={token} code={code} state={state} />;
}

function Stage({ token, code, state }: { token: string; code: string; state: GameState }) {
  const convex = useConvex();
  const updatePose = useMutation(api.game.updatePose);
  const beginCharge = useMutation(api.game.beginCharge);
  const fire = useMutation(api.game.fire);
  const { gameId } = state;

  const [match] = useState(() => {
    const transport: MatchTransport = {
      sendPose: (turnNumber, pose) => updatePose({ token, gameId, turnNumber, ...pose }),
      beginCharge: () => beginCharge({ token, gameId }),
      fire: (power, pose) => fire({ token, gameId, power, ...pose }),
    };
    return new NetworkMatch(state, transport);
  });
  const [locked, setLocked] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<InputSource | null>(null);
  const statsRef = useRef<FrameStats>({ fps: 0, hideActive: false });
  const isWatching = state.activePlayerId !== state.myPlayerId && state.status === 'active';
  const pose = useQuery(api.game.pose, isWatching ? { gameId } : 'skip');

  useEffect(() => match.sync(state), [match, state]);
  useEffect(() => match.syncPose(pose ?? null), [match, pose]);

  useEffect(() => {
    const input = createDesktopInput(containerRef.current!, setLocked);
    inputRef.current = input;
    return () => {
      input.dispose();
      inputRef.current = null;
    };
  }, []);

  // Half the round trip is the best estimate of when the server read its clock.
  useEffect(() => {
    const sentAt = Date.now();
    convex
      .mutation(api.game.serverTime, {})
      .then((serverNow) => {
        const receivedAt = Date.now();
        match.setClockOffset(serverNow - (sentAt + receivedAt) / 2);
      })
      .catch(() => {}); // The countdown is then only as good as this machine's clock.
  }, [convex, match]);

  // The results screen has a button, which a captured mouse couldn't reach.
  useEffect(() => {
    if (state.status === 'finished' && document.pointerLockElement) document.exitPointerLock();
  }, [state.status]);

  // Lets the browser console inspect a match in development.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    (window as unknown as { __match: NetworkMatch }).__match = match;
  }, [match]);

  return (
    <div ref={containerRef} className="fixed inset-0 overflow-hidden bg-sky-300">
      <Canvas flat shadows dpr={[1, 1.5]} camera={{ fov: 70, near: 0.1, far: 400, position: [32, 30, 70] }}>
        <GameScene match={match} inputRef={inputRef} statsRef={statsRef} />
      </Canvas>
      <GameHud
        match={match}
        statsRef={statsRef}
        locked={locked}
        finishedAction={<BackToRoom token={token} code={code} />}
      />
    </div>
  );
}

function BackToRoom({ token, code }: { token: string; code: string }) {
  const backToLobby = useMutation(api.rooms.backToLobby);
  const [error, setError] = useState('');
  return (
    <div
      className="flex flex-col items-center gap-2 [text-shadow:none]"
      onClick={(event) => event.stopPropagation()} // Otherwise the click would also capture the mouse.
    >
      <Button
        variant="primary"
        onClick={() => backToLobby({ token, code }).catch((failure) => setError(errorMessage(failure)))}
      >
        {strings.backToRoom}
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

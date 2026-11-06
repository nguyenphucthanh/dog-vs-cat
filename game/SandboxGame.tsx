'use client';

import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { useGameInput } from './input/useGameInput';
import { strings } from '../lib/strings';
import { GameHud } from './hud/GameHud';
import { LocalMatch } from './match/localMatch';
import { GameScene, type FrameStats } from './scene/GameScene';

function randomSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

function initialSeed() {
  const fromUrl = new URLSearchParams(window.location.search).get('seed');
  return fromUrl === null || Number.isNaN(Number(fromUrl)) ? randomSeed() : Number(fromUrl);
}

/** Hot-seat match on one machine, for tuning feel before any networking exists. */
export default function SandboxGame() {
  const [match, setMatch] = useState(() => new LocalMatch(initialSeed()));
  const containerRef = useRef<HTMLDivElement>(null);
  const { inputRef, touch, locked } = useGameInput(containerRef);
  const statsRef = useRef<FrameStats>({ fps: 0, hideActive: false, shake: 0 });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyR' && !event.metaKey && !event.ctrlKey) setMatch(new LocalMatch(randomSeed()));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Lets the browser console inspect and script a match while tuning.
  useEffect(() => {
    (window as unknown as { __match: LocalMatch }).__match = match;
  }, [match]);

  return (
    <div ref={containerRef} className="fixed inset-0 touch-none select-none overflow-hidden bg-sky-300">
      <Canvas
        key={match.seed}
        flat
        shadows={!touch}
        dpr={touch ? 1 : [1, 1.5]}
        camera={{ fov: 70, near: 0.1, far: 400, position: [32, 30, 70] }}
      >
        <GameScene match={match} inputRef={inputRef} statsRef={statsRef} />
      </Canvas>
      <GameHud match={match} statsRef={statsRef} locked={locked} touch={touch} finishedAction={strings.restart} />
    </div>
  );
}

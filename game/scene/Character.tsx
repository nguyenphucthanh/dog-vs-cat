'use client';

import { useFrame } from '@react-three/fiber';
import { useRef, type RefObject } from 'react';
import type { Group, Mesh } from 'three';
import type { Team } from '../../shared/game/turns';
import type { MatchPlayer, MatchView } from '../match/matchView';
import type { FrameStats } from './GameScene';

const AIRBORNE_LEG_SPLIT = 0.7;

const LOOKS: Record<Team, { fur: string; dark: string; light: string }> = {
  dog: { fur: '#b5763a', dark: '#6e4420', light: '#efd9b4' },
  cat: { fur: '#8c8f99', dark: '#4d4f58', light: '#e6e6ea' },
};

function Box({
  size,
  position,
  rotation,
  color,
}: {
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  color: string;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <boxGeometry args={size} />
      <meshLambertMaterial color={color} />
    </mesh>
  );
}

// Models face -Z, matching yaw 0. Their feet are at the origin and they fill the 0.8 x 1.8 x 0.8 hitbox.
function DogFeatures({ dark, light }: { dark: string; light: string }) {
  return (
    <>
      <Box size={[0.12, 0.28, 0.2]} position={[-0.29, 1.5, 0]} color={dark} />
      <Box size={[0.12, 0.28, 0.2]} position={[0.29, 1.5, 0]} color={dark} />
      <Box size={[0.24, 0.16, 0.2]} position={[0, 1.38, -0.32]} color={light} />
      <Box size={[0.1, 0.08, 0.04]} position={[0, 1.44, -0.43]} color="#1c1c1c" />
      <Box size={[0.1, 0.1, 0.32]} position={[0, 1.08, 0.3]} rotation={[0.7, 0, 0]} color={dark} />
    </>
  );
}

function CatFeatures({ dark, light }: { dark: string; light: string }) {
  return (
    <>
      <Box size={[0.13, 0.2, 0.08]} position={[-0.16, 1.76, 0]} color={dark} />
      <Box size={[0.13, 0.2, 0.08]} position={[0.16, 1.76, 0]} color={dark} />
      <Box size={[0.2, 0.1, 0.06]} position={[0, 1.38, -0.25]} color={light} />
      <Box size={[0.06, 0.05, 0.03]} position={[0, 1.42, -0.29]} color="#d9708a" />
      <Box size={[0.08, 0.08, 0.6]} position={[0, 1.0, 0.45]} rotation={[-0.6, 0, 0]} color={dark} />
    </>
  );
}

export function Character({
  match,
  player,
  statsRef,
}: {
  match: MatchView;
  player: MatchPlayer;
  statsRef: RefObject<FrameStats>;
}) {
  const rootRef = useRef<Group>(null);
  const leftLegRef = useRef<Mesh>(null);
  const rightLegRef = useRef<Mesh>(null);
  const bazookaRef = useRef<Group>(null);
  const markerRef = useRef<Mesh>(null);
  const look = LOOKS[player.team];

  useFrame(({ clock }) => {
    const root = rootRef.current!;
    root.visible = player.alive && !(match.activeId === player.id && statsRef.current.hideActive);
    if (!root.visible) return;
    root.position.set(player.body.x, player.body.y, player.body.z);
    root.rotation.y = player.yaw;
    bazookaRef.current!.rotation.x = player.pitch;
    // In the air the legs hold a split pose, so hops and falls read as actions.
    const walkSwing = player.walking ? Math.sin(clock.elapsedTime * 10) * 0.6 : 0;
    const swing = player.body.grounded ? walkSwing : AIRBORNE_LEG_SPLIT;
    leftLegRef.current!.rotation.x = swing;
    rightLegRef.current!.rotation.x = -swing;
    const marker = markerRef.current!;
    // While the camera sits on this player's shoulder the marker would only block the view.
    marker.visible = match.activeId === player.id && match.focus !== null;
    marker.position.y = 2.35 + Math.sin(clock.elapsedTime * 4) * 0.08;
  });

  return (
    <group ref={rootRef}>
      <mesh ref={leftLegRef} position={[-0.17, 0.25, 0]} castShadow>
        <boxGeometry args={[0.24, 0.5, 0.28]} />
        <meshLambertMaterial color={look.dark} />
      </mesh>
      <mesh ref={rightLegRef} position={[0.17, 0.25, 0]} castShadow>
        <boxGeometry args={[0.24, 0.5, 0.28]} />
        <meshLambertMaterial color={look.dark} />
      </mesh>
      <Box size={[0.6, 0.6, 0.38]} position={[0, 0.8, 0]} color={look.fur} />
      <Box size={[0.5, 0.5, 0.5]} position={[0, 1.4, 0]} color={look.fur} />
      <Box size={[0.08, 0.08, 0.03]} position={[-0.12, 1.5, -0.26]} color="#141414" />
      <Box size={[0.08, 0.08, 0.03]} position={[0.12, 1.5, -0.26]} color="#141414" />
      {player.team === 'dog' ? (
        <DogFeatures dark={look.dark} light={look.light} />
      ) : (
        <CatFeatures dark={look.dark} light={look.light} />
      )}
      <group ref={bazookaRef} position={[0.38, 1.1, 0]}>
        <Box size={[0.17, 0.17, 1.2]} position={[0, 0, -0.25]} color="#39453a" />
        <Box size={[0.23, 0.23, 0.14]} position={[0, 0, -0.86]} color="#222822" />
      </group>
      <mesh ref={markerRef} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.18, 0.3, 4]} />
        <meshBasicMaterial color="#ffd23f" />
      </mesh>
    </group>
  );
}

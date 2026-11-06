'use client';

import { useFrame } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { Color, InstancedMesh, Object3D } from 'three';
import type { MatchView } from '../match/matchView';
import { windDrift, wrapAround } from './windDrift';

const LEAVES = 45;
const STREAKS = 30;
const AREA = 34; // Wide and deep, around the camera: everything drifting in the wind stays inside this.
const AREA_HEIGHT = 16;
const MIN_CAMERA_DISTANCE = 1.5; // Anything closer would flash across the whole view.
const LEAF_SPEED = 0.7; // Leaves lag behind the air they float in, which the streaks show.
const LEAF_FALL_SPEED = 0.6;
const LEAF_SWAY = 0.35;
const LEAF_TUMBLE_RATE = 3;
const STREAK_MIN_LENGTH = 1.2;
const STREAK_LENGTH_PER_SPEED = 0.25;
const LEAF_COLORS = ['#6fae3f', '#a3c23f', '#e0a93a', '#d9772b'].map((hex) => new Color(hex));

type Mote = { x: number; y: number; z: number; phase: number };

function scatter(count: number): Mote[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * AREA,
    y: Math.random() * AREA_HEIGHT,
    z: Math.random() * AREA,
    phase: Math.random() * Math.PI * 2,
  }));
}

/** Leaves and streaks of air, so wind can be seen in the world and not only read off the HUD. Purely visual. */
export function WindEffects({ match }: { match: MatchView }) {
  const leavesRef = useRef<InstancedMesh>(null);
  const streaksRef = useRef<InstancedMesh>(null);
  const leavesData = useRef(scatter(LEAVES));
  const streaksData = useRef(scatter(STREAKS));
  const helper = useMemo(() => new Object3D(), []);
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  useLayoutEffect(() => {
    const mesh = leavesRef.current!;
    for (let i = 0; i < LEAVES; i++) mesh.setColorAt(i, LEAF_COLORS[i % LEAF_COLORS.length]);
    mesh.instanceColor!.needsUpdate = true;
  }, []);

  useFrame(({ camera, clock }, delta) => {
    const leafMesh = leavesRef.current!;
    const streakMesh = streaksRef.current!;
    const { directionX, directionZ, speed, amount } = windDrift(match.wind);
    leafMesh.count = reducedMotion ? 0 : Math.ceil(LEAVES * amount);
    streakMesh.count = reducedMotion ? 0 : Math.ceil(STREAKS * amount);

    const place = (mote: Mote, moveBy: number, fall: number) => {
      mote.x = wrapAround(mote.x + directionX * moveBy, camera.position.x, AREA);
      mote.y = wrapAround(mote.y - fall, camera.position.y, AREA_HEIGHT);
      mote.z = wrapAround(mote.z + directionZ * moveBy, camera.position.z, AREA);
      helper.position.set(mote.x, mote.y, mote.z);
      return helper.position.distanceTo(camera.position) >= MIN_CAMERA_DISTANCE ? 1 : 0;
    };

    for (let i = 0; i < leafMesh.count; i++) {
      const leaf = leavesData.current[i];
      const scale = place(leaf, speed * LEAF_SPEED * delta, LEAF_FALL_SPEED * delta);
      const time = clock.elapsedTime + leaf.phase;
      helper.position.setY(leaf.y + Math.sin(time * 2) * LEAF_SWAY);
      helper.rotation.set(time * LEAF_TUMBLE_RATE, leaf.phase, time * LEAF_TUMBLE_RATE * 0.7);
      helper.scale.setScalar(scale);
      helper.updateMatrix();
      leafMesh.setMatrixAt(i, helper.matrix);
    }
    leafMesh.instanceMatrix.needsUpdate = true;

    // A streak's long side lies along +X, so this turns it to point the way the wind blows.
    const heading = Math.atan2(-directionZ, directionX);
    const length = STREAK_MIN_LENGTH + speed * STREAK_LENGTH_PER_SPEED;
    for (let i = 0; i < streakMesh.count; i++) {
      const scale = place(streaksData.current[i], speed * delta, 0);
      helper.rotation.set(0, heading, 0);
      helper.scale.set(length * scale, scale, scale);
      helper.updateMatrix();
      streakMesh.setMatrixAt(i, helper.matrix);
    }
    streakMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={leavesRef} args={[undefined, undefined, LEAVES]} frustumCulled={false}>
        <boxGeometry args={[0.3, 0.04, 0.22]} />
        <meshBasicMaterial />
      </instancedMesh>
      <instancedMesh ref={streaksRef} args={[undefined, undefined, STREAKS]} frustumCulled={false}>
        <boxGeometry args={[1, 0.03, 0.03]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </instancedMesh>
    </>
  );
}

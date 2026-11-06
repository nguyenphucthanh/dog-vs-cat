'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { EXPLOSION_RADIUS, GRAVITY } from '../../shared/game/constants';
import type { MatchEffect, MatchView } from '../match/matchView';

const MAX_CUBES = 240;
const CUBES_PER_EXPLOSION = 60;
const CUBES_PER_SPLASH = 24;
const FLASH_SECONDS = 0.35;

type Cube = { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; size: number };

const EXPLOSION_COLORS = ['#7a5230', '#9a9a9f', '#5a8f3c', '#ff9d2e', '#3c3c3c'].map((hex) => new Color(hex));
const SPLASH_COLOR = new Color('#a8dcf0');

/** Block-shaped debris and a flash. Purely visual, so it may use Math.random freely. */
export function Effects({ match }: { match: MatchView }) {
  const cubesRef = useRef<InstancedMesh>(null);
  const flashRef = useRef<Mesh>(null);
  const flashAgeRef = useRef(Infinity);
  const nextSlotRef = useRef(0);
  const cubes = useRef<(Cube | null)[]>(Array.from({ length: MAX_CUBES }, () => null));
  const scratch = useMemo(
    () => ({ matrix: new Matrix4(), position: new Vector3(), scale: new Vector3(), rotation: new Quaternion() }),
    [],
  );

  const spawn = (effect: MatchEffect) => {
    const mesh = cubesRef.current!;
    const explosive = effect.kind === 'explosion';
    const count = explosive ? CUBES_PER_EXPLOSION : CUBES_PER_SPLASH;
    for (let i = 0; i < count; i++) {
      const slot = nextSlotRef.current;
      nextSlotRef.current = (slot + 1) % MAX_CUBES;
      const angle = Math.random() * Math.PI * 2;
      const speed = (explosive ? 4 : 1.5) + Math.random() * (explosive ? 10 : 3);
      cubes.current[slot] = {
        x: effect.at.x,
        y: effect.at.y,
        z: effect.at.z,
        vx: Math.cos(angle) * speed,
        vy: (explosive ? 4 : 5) + Math.random() * 10,
        vz: Math.sin(angle) * speed,
        life: 0.8 + Math.random() * 0.9,
        size: 0.12 + Math.random() * (explosive ? 0.3 : 0.1),
      };
      const palette = explosive ? EXPLOSION_COLORS[Math.floor(Math.random() * EXPLOSION_COLORS.length)] : SPLASH_COLOR;
      mesh.setColorAt(slot, palette);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (explosive) {
      flashRef.current!.position.set(effect.at.x, effect.at.y, effect.at.z);
      flashAgeRef.current = 0;
    }
  };

  useFrame((_, delta) => {
    for (const effect of match.drainEffects()) spawn(effect);

    const mesh = cubesRef.current!;
    const { matrix, position, scale, rotation } = scratch;
    for (let i = 0; i < MAX_CUBES; i++) {
      const cube = cubes.current[i];
      if (cube) {
        cube.vy -= GRAVITY * delta;
        cube.x += cube.vx * delta;
        cube.y += cube.vy * delta;
        cube.z += cube.vz * delta;
        cube.life -= delta;
        if (cube.life <= 0) cubes.current[i] = null;
      }
      const alive = cubes.current[i];
      position.set(alive?.x ?? 0, alive?.y ?? -100, alive?.z ?? 0);
      scale.setScalar(alive ? alive.size * Math.min(1, alive.life * 3) : 0);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    const flash = flashRef.current!;
    flashAgeRef.current += delta;
    const progress = flashAgeRef.current / FLASH_SECONDS;
    flash.visible = progress < 1;
    if (flash.visible) {
      flash.scale.setScalar(EXPLOSION_RADIUS * (0.4 + progress * 0.6));
      (flash.material as MeshBasicMaterial).opacity = 0.85 * (1 - progress);
    }
  });

  return (
    <>
      <instancedMesh ref={cubesRef} args={[undefined, undefined, MAX_CUBES]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial />
      </instancedMesh>
      <mesh ref={flashRef} visible={false}>
        <boxGeometry args={[2, 2, 2]} />
        <meshBasicMaterial color="#ffc04d" transparent depthWrite={false} />
      </mesh>
    </>
  );
}

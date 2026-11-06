'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { memo, useMemo, useRef, type RefObject } from 'react';
import { InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type Mesh } from 'three';
import { MAP_SIZE, PLAYER_HEIGHT, WATER_SURFACE } from '../../shared/game/constants';
import { aimToVelocity, muzzlePosition, previewArc } from '../../shared/game/projectile';
import { isSolid } from '../../shared/game/terrain';
import type { InputSource } from '../input/input';
import type { MatchView } from '../match/matchView';
import { Character } from './Character';
import { Effects } from './Effects';
import { TerrainView } from './TerrainView';

const SHOULDER_BACK = 4.5;
const SHOULDER_RIGHT = 0.9;
const SHOULDER_UP = 0.5;
const CAMERA_CLEARANCE = 0.3;
const HEIGHT_FOLLOW_RATE = 12; // Higher follows hops and falls more tightly, lower floats more.
const LOWEST_CAMERA_DROP = -0.4; // Aiming up must not swing the camera into the ground behind the player.
const MIN_FLAT_BACK = 0.7; // Keeps the camera back when aiming steeply, so the character stays out of the way.
const HIDE_CHARACTER_WITHIN = 1.8;
const FOLLOW_DISTANCE = 9;
const FOLLOW_HEIGHT = 3.5;
const SNAP_AFTER_SECONDS = 0.5; // Mouse look must be direct, so easing stops once back on the shoulder.
const PREVIEW_LENGTH = 3;
const PREVIEW_DOTS = 6;

const NO_INPUT = { moveForward: 0, moveRight: 0, jump: false, fire: false, yawDelta: 0, pitchDelta: 0 };

export type FrameStats = {
  fps: number;
  /** True when walls squeeze the camera so close that the active character would fill the screen. */
  hideActive: boolean;
};

/** Runs the match, then points the camera. Negative priority: before everything that draws. */
function MatchDriver({
  match,
  inputRef,
  statsRef,
}: {
  match: MatchView;
  inputRef: RefObject<InputSource | null>;
  statsRef: RefObject<FrameStats>;
}) {
  const camera = useThree((state) => state.camera);
  const shoulderSeconds = useRef(0);
  const followed = useRef({ id: '', y: 0 });
  const frames = useRef({ count: 0, seconds: 0 });
  const scratch = useMemo(
    () => ({
      target: new Vector3(),
      look: new Vector3(),
      helper: new Object3D(),
      quaternion: new Quaternion(),
    }),
    [],
  );

  useFrame((_, delta) => {
    match.update(delta * 1000, inputRef.current?.read() ?? NO_INPUT);

    const meter = frames.current;
    meter.count += 1;
    meter.seconds += delta;
    if (meter.seconds >= 0.5) {
      statsRef.current.fps = Math.round(meter.count / meter.seconds);
      meter.count = 0;
      meter.seconds = 0;
    }

    const { target, look, helper, quaternion } = scratch;
    const onShoulder = match.focus === null;
    const watch = followed.current;
    if (watch.id !== match.activeId || !onShoulder) {
      // A new player or the end of a shot: glide over instead of cutting.
      if (watch.id !== match.activeId) shoulderSeconds.current = 0;
      watch.id = match.activeId;
      watch.y = match.active.body.y;
    }
    if (onShoulder) {
      const { body, yaw, pitch } = match.active;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      const flat = Math.max(Math.cos(pitch), MIN_FLAT_BACK);
      watch.y += (body.y - watch.y) * (1 - Math.exp(-delta * HEIGHT_FOLLOW_RATE));
      const anchor = { x: body.x, y: watch.y + PLAYER_HEIGHT * 0.85, z: body.z };
      // Direction from the head to the ideal camera spot: behind the aim, off to the right, a bit up.
      const offset = {
        x: sin * flat * SHOULDER_BACK + cos * SHOULDER_RIGHT,
        y: Math.max(-Math.sin(pitch) * SHOULDER_BACK + SHOULDER_UP, LOWEST_CAMERA_DROP),
        z: cos * flat * SHOULDER_BACK - sin * SHOULDER_RIGHT,
      };
      const reach = clearDistance(match, anchor, offset);
      statsRef.current.hideActive = reach * Math.hypot(offset.x, offset.y, offset.z) < HIDE_CHARACTER_WITHIN;
      target.set(anchor.x + offset.x * reach, anchor.y + offset.y * reach, anchor.z + offset.z * reach);
      helper.rotation.set(pitch, yaw, 0, 'YXZ');
      quaternion.copy(helper.quaternion);
    } else {
      statsRef.current.hideActive = false;
      const focus = match.focus!;
      look.set(focus.x, focus.y, focus.z);
      const velocity = match.projectile?.velocity;
      if (velocity) {
        const flatSpeed = Math.hypot(velocity.x, velocity.z) || 1;
        target.set(
          focus.x - (velocity.x / flatSpeed) * FOLLOW_DISTANCE,
          focus.y + FOLLOW_HEIGHT,
          focus.z - (velocity.z / flatSpeed) * FOLLOW_DISTANCE,
        );
      } else {
        target.copy(camera.position); // Hold still and watch the explosion.
      }
      helper.position.copy(target);
      helper.lookAt(look); // Object3D faces +Z when looking at a target, so flip it for a camera.
      helper.rotateY(Math.PI);
      quaternion.copy(helper.quaternion);
      helper.position.set(0, 0, 0);
    }

    shoulderSeconds.current = onShoulder ? shoulderSeconds.current + delta : 0;
    const snapped = onShoulder && shoulderSeconds.current >= SNAP_AFTER_SECONDS;
    const ease = snapped ? 1 : 1 - Math.exp(-delta * (onShoulder ? 10 : 6));
    camera.position.lerp(target, ease);
    camera.quaternion.slerp(quaternion, ease);
  }, -1);

  return null;
}

/** How much of `offset` fits before hitting a block, so the camera never ends up inside the ground. */
function clearDistance(
  match: MatchView,
  from: { x: number; y: number; z: number },
  offset: { x: number; y: number; z: number },
): number {
  const length = Math.hypot(offset.x, offset.y, offset.z);
  const steps = Math.ceil(length / 0.25);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + offset.x * t;
    const y = from.y + offset.y * t;
    const z = from.z + offset.z * t;
    if (isSolid(match.terrain, Math.floor(x), Math.floor(y), Math.floor(z))) {
      return Math.max(0, t - CAMERA_CLEARANCE / length);
    }
  }
  return 1;
}

/** The first few blocks of the arc, shown only to the player who is aiming. */
function AimPreview({ match }: { match: MatchView }) {
  const dotsRef = useRef<InstancedMesh>(null);
  const matrix = useMemo(() => new Matrix4(), []);

  useFrame(() => {
    const dots = dotsRef.current!;
    dots.visible = match.showAimUi;
    if (!dots.visible) return;
    const { body, yaw, pitch } = match.active;
    const power = Math.max(match.power, 0.5);
    const points = previewArc(muzzlePosition(body, yaw, pitch), aimToVelocity(yaw, pitch, power), PREVIEW_LENGTH);
    points.slice(0, PREVIEW_DOTS).forEach((point, i) => {
      matrix.makeTranslation(point.x, point.y, point.z);
      dots.setMatrixAt(i, matrix);
    });
    dots.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={dotsRef} args={[undefined, undefined, PREVIEW_DOTS]} frustumCulled={false}>
      <boxGeometry args={[0.09, 0.09, 0.09]} />
      <meshBasicMaterial color="#fff27a" />
    </instancedMesh>
  );
}

function ProjectileView({ match }: { match: MatchView }) {
  const meshRef = useRef<Mesh>(null);
  useFrame(() => {
    const mesh = meshRef.current!;
    const shot = match.projectile;
    mesh.visible = shot !== null;
    if (shot) mesh.position.set(shot.position.x, shot.position.y, shot.position.z);
  });
  return (
    <mesh ref={meshRef} visible={false} castShadow>
      <boxGeometry args={[0.32, 0.32, 0.32]} />
      <meshBasicMaterial color="#2b2b2b" />
    </mesh>
  );
}

function Scene({
  match,
  inputRef,
  statsRef,
}: {
  match: MatchView;
  inputRef: RefObject<InputSource | null>;
  statsRef: RefObject<FrameStats>;
}) {
  const center = MAP_SIZE / 2;
  return (
    <>
      <color attach="background" args={['#8fd0f2']} />
      <fog attach="fog" args={['#8fd0f2', 70, 190]} />
      <hemisphereLight args={['#ffffff', '#6a7a60', 1.5]} />
      <directionalLight
        position={[center + 30, 70, center + 20]}
        intensity={1.8}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
        shadow-camera-far={160}
        shadow-bias={-0.0006}
      >
        <object3D attach="target" position={[center, 0, center]} />
      </directionalLight>

      <MatchDriver match={match} inputRef={inputRef} statsRef={statsRef} />
      <TerrainView match={match} />
      {match.players.map((player) => (
        <Character key={player.id} match={match} player={player} statsRef={statsRef} />
      ))}
      <AimPreview match={match} />
      <ProjectileView match={match} />
      <Effects match={match} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[center, WATER_SURFACE - 0.1, center]}>
        <planeGeometry args={[600, 600]} />
        <meshLambertMaterial color="#2f86c9" transparent opacity={0.78} />
      </mesh>
    </>
  );
}

// Everything in here reads the match each frame, so parent re-renders have nothing to add.
export const GameScene = memo(Scene);

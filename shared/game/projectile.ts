import {
  CHARGE_MS,
  FLIGHT_MARGIN,
  MUZZLE_HEIGHT,
  MUZZLE_REACH,
  GRAVITY,
  MAP_SIZE,
  MAX_FLIGHT_MS,
  MIN_POWER,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  PROJECTILE_SPEED,
  SHOOTER_IMMUNE_MS,
  SIM_DT,
  WATER_SURFACE,
} from './constants';
import { isSolid, type Terrain, type Vec3 } from './terrain';

export type Wind = { x: number; z: number };
export type Target = Vec3 & { id: string };

export type ShotInput = {
  terrain: Terrain;
  shooterId: string;
  origin: Vec3;
  velocity: Vec3;
  wind: Wind;
  players: readonly Target[];
};

export type Flight = {
  outcome: 'impact' | 'water' | 'out';
  point: Vec3;
  flightMs: number;
  hitPlayerId: string | null;
};

const MAX_SAMPLE_SPACING = 0.25;

/** Yaw 0 faces -Z and pitch is up, matching a three.js camera. Power is clamped to its legal range. */
export function aimToVelocity(yaw: number, pitch: number, power: number): Vec3 {
  const speed = PROJECTILE_SPEED * Math.min(1, Math.max(MIN_POWER, power));
  const flat = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * flat * speed,
    y: Math.sin(pitch) * speed,
    z: -Math.cos(yaw) * flat * speed,
  };
}

/** Where a shot starts for a player at `feet` aiming with this yaw and pitch. */
export function muzzlePosition(feet: Vec3, yaw: number, pitch: number): Vec3 {
  const flat = Math.cos(pitch);
  return {
    x: feet.x - Math.sin(yaw) * flat * MUZZLE_REACH,
    y: feet.y + MUZZLE_HEIGHT + Math.sin(pitch) * MUZZLE_REACH,
    z: feet.z - Math.cos(yaw) * flat * MUZZLE_REACH,
  };
}

/** Holding fire fills the bar in CHARGE_MS. Quick taps still fire at the minimum. */
export function powerFromCharge(chargeMs: number): number {
  return Math.min(1, Math.max(MIN_POWER, chargeMs / CHARGE_MS));
}

/** Exact for constant acceleration, so the path is a true parabola at any step size. */
export function stepProjectile(position: Vec3, velocity: Vec3, wind: Wind, dt = SIM_DT): void {
  position.x += velocity.x * dt + 0.5 * wind.x * dt * dt;
  position.y += velocity.y * dt - 0.5 * GRAVITY * dt * dt;
  position.z += velocity.z * dt + 0.5 * wind.z * dt * dt;
  velocity.x += wind.x * dt;
  velocity.y -= GRAVITY * dt;
  velocity.z += wind.z * dt;
}

/** The start of the arc for the aim preview. Wind is deliberately left out: reading it is the skill. */
export function previewArc(origin: Vec3, velocity: Vec3, length: number, spacing = 0.5): Vec3[] {
  const position = { ...origin };
  const current = { ...velocity };
  const dt = spacing / Math.max(1, Math.hypot(velocity.x, velocity.y, velocity.z));
  const points: Vec3[] = [];
  for (let travelled = 0; travelled < length; travelled += spacing) {
    stepProjectile(position, current, { x: 0, z: 0 }, dt);
    points.push({ ...position });
  }
  return points;
}

function insidePlayer(point: Vec3, player: Vec3): boolean {
  const half = PLAYER_WIDTH / 2;
  return (
    Math.abs(point.x - player.x) <= half &&
    Math.abs(point.z - player.z) <= half &&
    point.y >= player.y &&
    point.y <= player.y + PLAYER_HEIGHT
  );
}

/** Flies a shot until it hits something, reaches the water, or leaves play. */
export function simulateProjectile({ terrain, shooterId, origin, velocity, wind, players }: ShotInput): Flight {
  const position = { ...origin };
  const current = { ...velocity };
  const maxSteps = Math.ceil(MAX_FLIGHT_MS / 1000 / SIM_DT);

  for (let step = 0; step < maxSteps; step++) {
    const from = { ...position };
    stepProjectile(position, current, wind);
    const flightMs = (step + 1) * SIM_DT * 1000;
    const shooterImmune = flightMs <= SHOOTER_IMMUNE_MS;

    // Sample along the segment: a falling shot can cross more than a block per step.
    const distance = Math.hypot(position.x - from.x, position.y - from.y, position.z - from.z);
    const samples = Math.max(1, Math.ceil(distance / MAX_SAMPLE_SPACING));
    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples;
      const point = {
        x: from.x + (position.x - from.x) * t,
        y: from.y + (position.y - from.y) * t,
        z: from.z + (position.z - from.z) * t,
      };
      const hit = players.find((p) => !(shooterImmune && p.id === shooterId) && insidePlayer(point, p));
      if (hit) return { outcome: 'impact', point, flightMs, hitPlayerId: hit.id };
      if (isSolid(terrain, Math.floor(point.x), Math.floor(point.y), Math.floor(point.z))) {
        return { outcome: 'impact', point, flightMs, hitPlayerId: null };
      }
      if (point.y < WATER_SURFACE) return { outcome: 'water', point, flightMs, hitPlayerId: null };
    }

    const outside =
      position.x < -FLIGHT_MARGIN ||
      position.x > MAP_SIZE + FLIGHT_MARGIN ||
      position.z < -FLIGHT_MARGIN ||
      position.z > MAP_SIZE + FLIGHT_MARGIN;
    if (outside) return { outcome: 'out', point: { ...position }, flightMs, hitPlayerId: null };
  }
  return { outcome: 'out', point: position, flightMs: MAX_FLIGHT_MS, hitPlayerId: null };
}

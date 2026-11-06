import {
  FALL_DAMAGE_PER_BLOCK,
  GRAVITY,
  GROUND_FRICTION,
  JUMP_HEIGHT,
  MAX_FALL_SPEED,
  MAX_SETTLE_MS,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SAFE_FALL,
  SIM_DT,
  STEP_HOP_HEIGHT,
  WALK_SPEED,
  WATER_SURFACE,
} from './constants';
import { isSolid, type Terrain, type Vec3 } from './terrain';

/** A player's physical state. (x, y, z) is the centre of the feet. vx/vz hold knockback only. */
export type Body = Vec3 & {
  vx: number;
  vy: number;
  vz: number;
  grounded: boolean;
  peakY: number;
};

export type MoveInput = { moveX: number; moveZ: number; jump: boolean };

const NO_INPUT: MoveInput = { moveX: 0, moveZ: 0, jump: false };
const HALF_WIDTH = PLAYER_WIDTH / 2;
const EPSILON = 1e-6;
const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
const STEP_HOP_SPEED = Math.sqrt(2 * GRAVITY * STEP_HOP_HEIGHT);

export function createBody({ x, y, z }: Vec3): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, grounded: false, peakY: y };
}

export function fallDamage(distance: number): number {
  return Math.round(Math.max(0, distance - SAFE_FALL) * FALL_DAMAGE_PER_BLOCK);
}

export function isDrowned(y: number): boolean {
  return y < WATER_SURFACE;
}

function collides(terrain: Terrain, x: number, y: number, z: number): boolean {
  const minX = Math.floor(x - HALF_WIDTH);
  const maxX = Math.floor(x + HALF_WIDTH - EPSILON);
  const minY = Math.floor(y);
  const maxY = Math.floor(y + PLAYER_HEIGHT - EPSILON);
  const minZ = Math.floor(z - HALF_WIDTH);
  const maxZ = Math.floor(z + HALF_WIDTH - EPSILON);
  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        if (isSolid(terrain, bx, by, bz)) return true;
      }
    }
  }
  return false;
}

/** Walking into a one-block ledge starts a small real hop; the walk carries over once high enough. */
function hopIfLedge(terrain: Terrain, body: Body, nextX: number, nextZ: number): void {
  if (!body.grounded) return;
  const ledgeIsClear = !collides(terrain, nextX, body.y + 1, nextZ);
  const headroomAbove = !collides(terrain, body.x, body.y + 1, body.z);
  if (ledgeIsClear && headroomAbove) {
    body.vy = STEP_HOP_SPEED;
    body.grounded = false;
  }
}

/** Advances a body one fixed step, mutating it. Returns fall damage if it landed this step. */
export function stepBody(terrain: Terrain, body: Body, input: MoveInput = NO_INPUT, dt = SIM_DT): number {
  if (input.jump && body.grounded) {
    body.vy = JUMP_SPEED;
    body.grounded = false;
  }

  const length = Math.hypot(input.moveX, input.moveZ);
  const scale = length > 1 ? WALK_SPEED / length : WALK_SPEED;
  const walking = length > 0;

  const nextX = body.x + (input.moveX * scale + body.vx) * dt;
  if (!collides(terrain, nextX, body.y, body.z)) {
    body.x = nextX;
  } else {
    body.vx = 0;
    if (walking) hopIfLedge(terrain, body, nextX, body.z);
  }

  const nextZ = body.z + (input.moveZ * scale + body.vz) * dt;
  if (!collides(terrain, body.x, body.y, nextZ)) {
    body.z = nextZ;
  } else {
    body.vz = 0;
    if (walking) hopIfLedge(terrain, body, body.x, nextZ);
  }

  body.vy = Math.max(body.vy - GRAVITY * dt, -MAX_FALL_SPEED);
  const nextY = body.y + body.vy * dt;
  let damage = 0;
  if (!collides(terrain, body.x, nextY, body.z)) {
    body.y = nextY;
    body.grounded = false;
  } else if (body.vy <= 0) {
    body.y = Math.floor(nextY) + 1;
    body.vy = 0;
    body.grounded = true;
    damage = fallDamage(body.peakY - body.y);
  } else {
    body.vy = 0;
    body.grounded = false;
  }

  if (body.grounded) {
    body.peakY = body.y;
    body.vx = decayKnockback(body.vx);
    body.vz = decayKnockback(body.vz);
  } else {
    body.peakY = Math.max(body.peakY, body.y);
  }
  return damage;
}

function decayKnockback(speed: number): number {
  const next = speed * GROUND_FRICTION;
  return Math.abs(next) < 0.05 ? 0 : next;
}

export type Settled = Vec3 & { fallDamage: number; drowned: boolean };

/** Runs a body with no input until it stops or drowns. Used after explosions and at turn end. */
export function settleBody(terrain: Terrain, body: Body): Settled {
  let damage = 0;
  const maxSteps = Math.ceil(MAX_SETTLE_MS / 1000 / SIM_DT);
  for (let step = 0; step < maxSteps; step++) {
    damage += stepBody(terrain, body);
    if (isDrowned(body.y)) break;
    if (body.grounded && body.vx === 0 && body.vz === 0) break;
  }
  return { x: body.x, y: body.y, z: body.z, fallDamage: damage, drowned: isDrowned(body.y) };
}

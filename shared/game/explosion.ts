import {
  CRATER_RADIUS,
  EXPLOSION_DAMAGE,
  EXPLOSION_RADIUS,
  KNOCKBACK_SPEED,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from './constants';
import { createBody, settleBody } from './player';
import { simulateProjectile, type ShotInput, type Target } from './projectile';
import { carveSphere, type Terrain, type Vec3 } from './terrain';

export type Combatant = Target & { hp: number };

export type Hit = {
  playerId: string;
  damage: number;
  knockback: Vec3;
  finalPos: Vec3;
  hpAfter: number;
  died: boolean;
};

export type ShotResult = {
  flightMs: number;
  impact: Vec3 | null; // Null when the shot ended in water or out of play: no explosion.
  hits: Hit[];
};

/** Distance to the nearest point of the player's box, so a direct hit counts as dead centre. */
function distanceToPlayer(center: Vec3, player: Vec3): number {
  const half = PLAYER_WIDTH / 2;
  const dx = Math.max(Math.abs(center.x - player.x) - half, 0);
  const dz = Math.max(Math.abs(center.z - player.z) - half, 0);
  const dy = Math.max(player.y - center.y, center.y - (player.y + PLAYER_HEIGHT), 0);
  return Math.hypot(dx, dy, dz);
}

export function explosionDamage(center: Vec3, player: Vec3): number {
  const falloff = 1 - distanceToPlayer(center, player) / EXPLOSION_RADIUS;
  return Math.round(EXPLOSION_DAMAGE * Math.max(0, falloff));
}

/** Pushes away from the blast and slightly upward. Zero outside the blast radius. */
export function explosionKnockback(center: Vec3, player: Vec3): Vec3 {
  const falloff = 1 - distanceToPlayer(center, player) / EXPLOSION_RADIUS;
  if (falloff <= 0) return { x: 0, y: 0, z: 0 };
  const dx = player.x - center.x;
  const dy = player.y + PLAYER_HEIGHT / 2 - center.y + 0.5;
  const dz = player.z - center.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  const speed = KNOCKBACK_SPEED * falloff;
  return { x: (dx / length) * speed, y: (dy / length) * speed, z: (dz / length) * speed };
}

/** Applies an explosion at `center`, mutating the terrain. Everyone alive settles afterwards, in or out of range. */
export function resolveExplosion(terrain: Terrain, center: Vec3, players: readonly Combatant[]): Hit[] {
  carveSphere(terrain, { ...center, radius: CRATER_RADIUS });
  const hits: Hit[] = [];
  for (const player of players) {
    const damage = explosionDamage(center, player);
    const knockback = explosionKnockback(center, player);
    const body = createBody(player);
    body.vx = knockback.x;
    body.vy = knockback.y;
    body.vz = knockback.z;
    const settled = settleBody(terrain, body);
    const total = damage + settled.fallDamage;
    const moved = settled.x !== player.x || settled.y !== player.y || settled.z !== player.z;
    if (total === 0 && !moved && !settled.drowned) continue;
    const hpAfter = settled.drowned ? 0 : Math.max(0, player.hp - total);
    hits.push({
      playerId: player.id,
      damage: total,
      knockback,
      finalPos: { x: settled.x, y: settled.y, z: settled.z },
      hpAfter,
      died: hpAfter === 0,
    });
  }
  return hits;
}

/** The whole outcome of a shot. `players` must be the living players; the terrain is mutated. */
export function resolveShot(input: Omit<ShotInput, 'players'> & { players: readonly Combatant[] }): ShotResult {
  const flight = simulateProjectile(input);
  if (flight.outcome !== 'impact') return { flightMs: flight.flightMs, impact: null, hits: [] };
  return {
    flightMs: flight.flightMs,
    impact: flight.point,
    hits: resolveExplosion(input.terrain, flight.point, input.players),
  };
}

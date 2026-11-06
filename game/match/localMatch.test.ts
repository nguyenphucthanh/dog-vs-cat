import { describe, expect, it } from 'vitest';
import {
  CHARGE_MS,
  EXPLOSION_PAUSE_MS,
  MAX_HP,
  RETREAT_MS,
  TURN_MS,
  WIND_MAX_CHANGE,
} from '../../shared/game/constants';
import { muzzlePosition } from '../../shared/game/projectile';
import type { FrameInput } from '../input/input';
import { LocalMatch } from './localMatch';

const IDLE: FrameInput = { moveForward: 0, moveRight: 0, jump: false, fire: false, yawDelta: 0, pitchDelta: 0 };
const HOLD_FIRE: FrameInput = { ...IDLE, fire: true };

function run(match: LocalMatch, ms: number, input: FrameInput = IDLE) {
  for (let t = 0; t < ms; t += 16) match.update(16, input);
}

/** Runs until the phase changes, so tests don't depend on a shot's flight time. */
function runUntilPhase(match: LocalMatch, phase: LocalMatch['phase'], limitMs = 30_000) {
  for (let t = 0; t < limitMs && match.phase !== phase; t += 16) match.update(16, IDLE);
  expect(match.phase).toBe(phase);
}

/** Puts `victim` right in front of the active player's barrel. */
function placeInFront(match: LocalMatch, victimId: string) {
  const shooter = match.active;
  const victim = match.players.find((p) => p.id === victimId)!;
  const muzzle = muzzlePosition(shooter.body, shooter.yaw, shooter.pitch);
  const dx = muzzle.x - shooter.body.x;
  const dz = muzzle.z - shooter.body.z;
  victim.body.x = muzzle.x + dx * 2;
  victim.body.z = muzzle.z + dz * 2;
  victim.body.y = muzzle.y - 1;
}

describe('LocalMatch', () => {
  it('forfeits an idle turn when time runs out and alternates the team', () => {
    const match = new LocalMatch(1);
    const firstTeam = match.active.team;
    const firstWind = match.wind;
    run(match, TURN_MS + 100);
    expect(match.active.team).not.toBe(firstTeam);
    expect(match.phase).toBe('aiming');
    expect(match.turnNumber).toBe(2);
    expect(Math.hypot(match.wind.x - firstWind.x, match.wind.z - firstWind.z)).toBeLessThanOrEqual(
      WIND_MAX_CHANGE + 1e-9,
    );
  });

  it('fires on release with the charged power', () => {
    const match = new LocalMatch(1);
    run(match, CHARGE_MS / 2, HOLD_FIRE);
    expect(match.power).toBeCloseTo(0.5, 1);
    run(match, 32);
    expect(match.phase).toBe('resolving');
    expect(match.projectile).not.toBeNull();
    const speed = Math.hypot(...Object.values(match.projectile!.velocity));
    expect(speed).toBeGreaterThan(15);
    expect(speed).toBeLessThan(25);
  });

  it('fires by itself when the bar fills', () => {
    const match = new LocalMatch(1);
    run(match, CHARGE_MS + 50, HOLD_FIRE);
    expect(match.phase).toBe('resolving');
  });

  it('auto-fires when time runs out mid-charge', () => {
    const match = new LocalMatch(1);
    match.phaseMsLeft = 300;
    run(match, 400, HOLD_FIRE);
    expect(match.phase).toBe('resolving');
  });

  it('pauses the turn clock during flight, then allows retreat but no second shot', () => {
    const match = new LocalMatch(1);
    const shooterId = match.activeId;
    run(match, 500, HOLD_FIRE);
    run(match, 32);
    const clock = match.phaseMsLeft;
    run(match, 200);
    expect(match.phaseMsLeft).toBe(clock);

    runUntilPhase(match, 'retreat');
    if (match.activeId !== shooterId) throw new Error('Shooter should keep the retreat');
    const from = { ...match.active.body };
    run(match, 500, { ...IDLE, moveForward: 1, fire: true });
    expect(match.phase).toBe('retreat');
    expect(Math.hypot(match.active.body.x - from.x, match.active.body.z - from.z)).toBeGreaterThan(0.5);

    run(match, RETREAT_MS);
    expect(match.activeId).not.toBe(shooterId);
    expect(match.turnNumber).toBe(2);
  });

  it('does not start charging the next turn while fire is still held', () => {
    const match = new LocalMatch(1);
    run(match, CHARGE_MS + 50, HOLD_FIRE);
    runUntilPhase(match, 'retreat');
    run(match, RETREAT_MS + 100, HOLD_FIRE);
    expect(match.phase).toBe('aiming');
    expect(match.chargeMs).toBeNull();
    run(match, 32);
    run(match, 32, HOLD_FIRE);
    expect(match.chargeMs).not.toBeNull();
  });

  it('applies damage, carves the terrain and reports the chunks to redraw', () => {
    const match = new LocalMatch(1);
    const victim = match.players.find((p) => p.team !== match.active.team)!;
    placeInFront(match, victim.id);
    const solidBefore = match.terrain.blocks.filter(Boolean).length;
    run(match, 200, HOLD_FIRE);
    run(match, 32);
    runUntilPhase(match, 'retreat');
    expect(victim.hp).toBeLessThan(MAX_HP);
    expect(match.terrain.blocks.filter(Boolean).length).toBeLessThanOrEqual(solidBefore);
    expect(match.drainDirtyChunks().length).toBeGreaterThan(0);
    expect(match.drainDirtyChunks()).toEqual([]);
    expect(match.drainEffects().map((e) => e.kind)).toEqual(['explosion']);
  });

  it('ends when a whole team is dead and names the winner', () => {
    const match = new LocalMatch(1, 1);
    const shooterTeam = match.active.team;
    const victim = match.players.find((p) => p.team !== shooterTeam)!;
    victim.hp = 1;
    placeInFront(match, victim.id);
    run(match, 200, HOLD_FIRE);
    run(match, 32);
    runUntilPhase(match, 'finished', 10_000 + EXPLOSION_PAUSE_MS + RETREAT_MS);
    expect(victim.alive).toBe(false);
    expect(match.winner).toBe(shooterTeam);
  });

  it.each([1, 2, 3, 42])('walks across real terrain on seed %i without teleporting or getting stuck', (seed) => {
    const match = new LocalMatch(seed);
    const player = match.active;
    const start = { x: player.body.x, z: player.body.z };
    let biggestRise = 0;
    let climbed = 0;
    for (let t = 0; t < 8_000 && match.activeId === player.id; t += 16) {
      const before = player.body.y;
      match.update(16, { ...IDLE, moveForward: 1 });
      const rise = player.body.y - before;
      biggestRise = Math.max(biggestRise, rise);
      if (rise > 0) climbed += rise;
    }
    const travelled = Math.hypot(player.body.x - start.x, player.body.z - start.z);
    console.log(
      `seed ${seed}: travelled ${travelled.toFixed(1)}, climbed ${climbed.toFixed(1)}, biggest rise ${biggestRise.toFixed(2)}`,
    );
    expect(biggestRise).toBeLessThan(0.3); // Two sim steps can land in one frame.
    expect(travelled).toBeGreaterThan(5);
  });

  it('kills a player who walks into the sea and moves on', () => {
    const match = new LocalMatch(1);
    const swimmer = match.active;
    swimmer.body.x = -5;
    swimmer.body.grounded = false;
    run(match, 3000);
    expect(swimmer.alive).toBe(false);
    expect(match.activeId).not.toBe(swimmer.id);
  });
});

/// <reference types="vite/client" />
import presenceTest from '@convex-dev/presence/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARGE_MS,
  MIN_POWER,
  OFFLINE_TURN_MS,
  POWER_TOLERANCE,
  PROJECTILE_SPEED,
  TURN_MS,
  WALK_SPEED,
  WIND_MAX_CHANGE,
} from '../shared/game/constants';
import { generateTerrain, topSolidY } from '../shared/game/terrain';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
let now = 1_000_000;

function advance(ms: number) {
  now += ms;
  vi.setSystemTime(now); // Moves the clock without running scheduled functions; tests run those by hand.
}

async function errorCode(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConvexError) return error.data;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

async function startedGame(perTeam = 1) {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  const tokens: string[] = [];
  for (let i = 0; i < perTeam * 2; i++) {
    const token = crypto.randomUUID();
    await t.mutation(api.guests.create, { token, name: `P${i}` });
    tokens.push(token);
  }
  const code = await t.mutation(api.rooms.create, { token: tokens[0] });
  for (const [i, token] of tokens.entries()) {
    if (i > 0) await t.mutation(api.rooms.join, { token, code });
    await t.mutation(api.rooms.setTeam, { token, code, team: i % 2 === 0 ? 'dog' : 'cat' });
    if (i > 0) await t.mutation(api.rooms.setReady, { token, code, ready: true });
    await t.mutation(api.presence.heartbeat, { token, code, sessionId: token });
  }
  await t.mutation(api.rooms.start, { token: tokens[0], code });

  const state = async (token = tokens[0]) => (await t.query(api.game.state, { token, code }))!;
  const first = await state();
  const gameId = first.gameId;

  const tokenOf = async (playerId: string) => {
    for (const token of tokens) if ((await state(token)).myPlayerId === playerId) return token;
    throw new Error('No such player');
  };
  const activeToken = async () => tokenOf((await state()).activePlayerId);
  const idleToken = async () => {
    const { activePlayerId } = await state();
    for (const token of tokens) if ((await state(token)).myPlayerId !== activePlayerId) return token;
    throw new Error('Everyone is active');
  };
  const timeout = async (phase?: 'aiming' | 'resolving' | 'retreat') => {
    const current = await state();
    await t.mutation(internal.game.onPhaseTimeout, {
      gameId,
      turnNumber: current.turnNumber,
      phase: phase ?? current.phase,
    });
  };
  const poseOf = async () => (await t.query(api.game.pose, { gameId }))!;
  const aim = async () => {
    const { x, y, z, yaw, pitch, grounded } = await poseOf();
    return { x, y, z, yaw, pitch, grounded };
  };
  /** Puts the active player and everyone else side by side on top of the island. */
  const gatherPlayers = async () => {
    const current = await state();
    const terrain = generateTerrain(current.seed);
    const x = 32;
    const z = 32;
    await t.run(async (ctx) => {
      for (const [i, player] of current.players.entries()) {
        const px = x + i * 2;
        const y = topSolidY(terrain, px, z) + 1;
        await ctx.db.patch('gamePlayers', player.id as Id<'gamePlayers'>, { x: px + 0.5, y, z: z + 0.5 });
        if (player.id === current.activePlayerId) {
          const live = await ctx.db.query('livePoses').first();
          await ctx.db.patch('livePoses', live!._id, { x: px + 0.5, y, z: z + 0.5, peakY: y });
        }
      }
    });
  };
  return { t, tokens, code, gameId, state, tokenOf, activeToken, idleToken, timeout, aim, poseOf, gatherPlayers };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

describe('starting a match', () => {
  it('moves the room into a running game with one player for each online member', async () => {
    const { state, tokens } = await startedGame(2);
    const game = await state();
    expect(game.status).toBe('active');
    expect(game.phase).toBe('aiming');
    expect(game.turnNumber).toBe(1);
    expect(game.players).toHaveLength(4);
    expect(game.players.every((p) => p.hp === 100 && p.alive)).toBe(true);
    expect(Math.abs(game.phaseEndsAt - now - TURN_MS)).toBeLessThan(50);
    const ids = await Promise.all(tokens.map(async (token) => (await state(token)).myPlayerId));
    expect(new Set(ids).size).toBe(4);
  });

  it('gives each player a spawn on their own half', async () => {
    const { state } = await startedGame(2);
    for (const player of (await state()).players) {
      if (player.team === 'dog') expect(player.x).toBeLessThan(32);
      else expect(player.x).toBeGreaterThanOrEqual(32);
    }
  });

  it('never exposes tokens or guest ids', async () => {
    const { t, state, tokens } = await startedGame();
    const guests = await t.run((ctx) => ctx.db.query('guests').collect());
    const everything = JSON.stringify(await state());
    for (const token of tokens) expect(everything).not.toContain(token);
    for (const guest of guests) {
      expect(everything).not.toContain(guest._id);
      expect(everything).not.toContain(guest.tokenHash);
    }
  });

  it('shows nothing to someone outside the room', async () => {
    const { t, code } = await startedGame();
    const outsider = crypto.randomUUID();
    await t.mutation(api.guests.create, { token: outsider, name: 'Out' });
    expect(await t.query(api.game.state, { token: outsider, code })).toBeNull();
    expect(await t.query(api.game.state, { token: 'x'.repeat(40), code })).toBeNull();
  });
});

describe('only the active player acts', () => {
  it('rejects shots, charging and poses from anyone else', async () => {
    const { t, gameId, idleToken, aim, poseOf } = await startedGame();
    const token = await idleToken();
    const pose = await aim();
    expect(await errorCode(t.mutation(api.game.fire, { token, gameId, power: 1, ...pose }))).toBe('NOT_YOUR_TURN');
    expect(await errorCode(t.mutation(api.game.beginCharge, { token, gameId }))).toBe('NOT_YOUR_TURN');
    const before = await poseOf();
    expect(
      await errorCode(t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...pose, x: pose.x + 0.5 })),
    ).toBe('NOT_YOUR_TURN');
    expect((await poseOf()).x).toBe(before.x);
  });

  it('rejects unknown guests and outsiders', async () => {
    const { t, gameId, aim } = await startedGame();
    const fake = crypto.randomUUID();
    expect(await errorCode(t.mutation(api.game.fire, { token: fake, gameId, power: 1, ...(await aim()) }))).toBe(
      'UNKNOWN_GUEST',
    );
    await t.mutation(api.guests.create, { token: fake, name: 'Out' });
    expect(await errorCode(t.mutation(api.game.beginCharge, { token: fake, gameId }))).toBe('NOT_A_MEMBER');
  });
});

describe('moving', () => {
  it('accepts walking and ignores teleporting', async () => {
    const { t, gameId, activeToken, aim, poseOf } = await startedGame();
    const token = await activeToken();
    const start = await aim();
    advance(1000);
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, x: start.x + WALK_SPEED });
    expect((await poseOf()).x).toBe(start.x + WALK_SPEED);

    advance(200);
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, x: start.x + 40 });
    expect((await poseOf()).x).toBe(start.x + WALK_SPEED);
  });

  it('ignores flying and impossible numbers', async () => {
    const { t, gameId, activeToken, aim, poseOf } = await startedGame();
    const token = await activeToken();
    const start = await aim();
    advance(200);
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, y: start.y + 20 });
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, x: NaN });
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, x: 9999 });
    const pose = await poseOf();
    expect(pose.y).toBe(start.y);
    expect(pose.x).toBe(start.x);
  });

  it('ignores a stale pose from an earlier turn', async () => {
    const { t, gameId, activeToken, aim, poseOf } = await startedGame();
    const token = await activeToken();
    const start = await aim();
    advance(1000);
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 99, ...start, x: start.x + 1 });
    expect((await poseOf()).x).toBe(start.x);
  });

  it('kills a player who walks into the sea and hands over the turn', async () => {
    const { t, gameId, state, activeToken, aim } = await startedGame(2);
    const token = await activeToken();
    const before = await state();
    const start = await aim();
    await t.run(async (ctx) => {
      const live = await ctx.db.query('livePoses').first();
      await ctx.db.patch('livePoses', live!._id, { x: 1, y: 6, z: 1, peakY: 6 });
    });
    advance(1000);
    await t.mutation(api.game.updatePose, {
      token,
      gameId,
      turnNumber: 1,
      ...start,
      x: 1,
      y: 4,
      z: 1,
      grounded: false,
    });
    const after = await state();
    expect(after.players.find((p) => p.id === before.activePlayerId)!.alive).toBe(false);
    expect(after.activePlayerId).not.toBe(before.activePlayerId);
    expect(after.turnNumber).toBe(2);
  });

  it('charges fall damage when landing from high up', async () => {
    const { t, gameId, state, activeToken, aim } = await startedGame();
    const token = await activeToken();
    const start = await aim();
    await t.run(async (ctx) => {
      const live = await ctx.db.query('livePoses').first();
      await ctx.db.patch('livePoses', live!._id, { y: 18, peakY: 18, grounded: false });
    });
    advance(1000);
    await t.mutation(api.game.updatePose, { token, gameId, turnNumber: 1, ...start, y: 12, grounded: true });
    const game = await state();
    expect(game.players.find((p) => p.id === game.activePlayerId)!.hp).toBe(90);
  });
});

describe('shooting', () => {
  it('limits power to what was actually charged', async () => {
    const { t, gameId, state, activeToken, aim } = await startedGame();
    const token = await activeToken();
    await t.mutation(api.game.fire, { token, gameId, power: 1, ...(await aim()) });
    const { lastShot } = await state();
    const speed = Math.hypot(lastShot!.velocity.x, lastShot!.velocity.y, lastShot!.velocity.z);
    expect(speed).toBeCloseTo(PROJECTILE_SPEED * (MIN_POWER + POWER_TOLERANCE));
  });

  it('allows full power after a full charge', async () => {
    const { t, gameId, state, activeToken, aim } = await startedGame();
    const token = await activeToken();
    await t.mutation(api.game.beginCharge, { token, gameId });
    advance(CHARGE_MS);
    await t.mutation(api.game.fire, { token, gameId, power: 1, ...(await aim()) });
    const { lastShot } = await state();
    expect(Math.hypot(lastShot!.velocity.x, lastShot!.velocity.y, lastShot!.velocity.z)).toBeCloseTo(PROJECTILE_SPEED);
  });

  it('fires from the position sent with the shot', async () => {
    const { t, gameId, state, activeToken, aim } = await startedGame();
    const token = await activeToken();
    const pose = await aim();
    advance(1000);
    await t.mutation(api.game.fire, { token, gameId, power: 0.2, ...pose, x: pose.x + 1 });
    const { lastShot } = await state();
    expect(Math.abs(lastShot!.origin.x - (pose.x + 1))).toBeLessThan(1);
  });

  it('allows one shot per turn', async () => {
    const { t, gameId, activeToken, aim } = await startedGame();
    const token = await activeToken();
    const pose = await aim();
    await t.mutation(api.game.fire, { token, gameId, power: 0.2, ...pose });
    expect(await errorCode(t.mutation(api.game.fire, { token, gameId, power: 0.2, ...pose }))).toBe('WRONG_PHASE');
    expect(await errorCode(t.mutation(api.game.beginCharge, { token, gameId }))).toBe('WRONG_PHASE');
  });

  it('rejects an aim that is not a number', async () => {
    const { t, gameId, activeToken, aim } = await startedGame();
    const token = await activeToken();
    expect(await errorCode(t.mutation(api.game.fire, { token, gameId, power: NaN, ...(await aim()) }))).toBe(
      'INVALID_AIM',
    );
  });

  it('damages players near the blast and records the crater', async () => {
    const { t, gameId, state, activeToken, aim, gatherPlayers } = await startedGame();
    await gatherPlayers();
    const token = await activeToken();
    // Straight down at your own feet: the other player stands two blocks away.
    await t.mutation(api.game.fire, { token, gameId, power: 0.2, ...(await aim()), pitch: -1.4 });
    const game = await state();
    expect(game.phase).toBe('resolving');
    expect(game.craters).toHaveLength(1);
    expect(game.lastShot!.impact).not.toBeNull();
    expect(game.lastShot!.hits.length).toBeGreaterThan(0);
    const shooter = game.players.find((p) => p.id === game.activePlayerId)!;
    expect(shooter.hp).toBeLessThan(100);
    for (const hit of game.lastShot!.hits) {
      expect(game.players.find((p) => p.id === hit.playerId)!.hp).toBe(hit.hpAfter);
    }
  });

  it('runs resolving, retreat, then the next team with a drifted wind', async () => {
    const { t, gameId, state, activeToken, aim, timeout } = await startedGame();
    const token = await activeToken();
    const start = await state();
    await t.mutation(api.game.fire, { token, gameId, power: 0.3, ...(await aim()), pitch: 0.5 });
    await timeout();
    const retreat = await state();
    if (retreat.status === 'finished') return; // Blew themselves up on this seed.
    expect(retreat.phase).toBe('retreat');
    expect(retreat.activePlayerId).toBe(start.activePlayerId);
    await timeout();
    const next = await state();
    if (next.status === 'finished') return;
    expect(next.phase).toBe('aiming');
    expect(next.turnNumber).toBe(2);
    expect(next.activePlayerId).not.toBe(start.activePlayerId);
    const wind = Math.hypot(next.wind.x - start.wind.x, next.wind.z - start.wind.z);
    expect(wind).toBeLessThanOrEqual(WIND_MAX_CHANGE + 1e-9);
  });
});

describe('timeouts', () => {
  it('does nothing when it arrives after the game moved on', async () => {
    const { t, gameId, state, activeToken, aim, timeout } = await startedGame();
    const token = await activeToken();
    await t.mutation(api.game.fire, { token, gameId, power: 0.2, ...(await aim()), pitch: 0.5 });
    const before = await state();
    await timeout('aiming');
    await t.mutation(internal.game.onPhaseTimeout, { gameId, turnNumber: 99, phase: 'resolving' });
    expect(await state()).toEqual(before);
  });

  it('does nothing for a game that no longer exists', async () => {
    const { t, gameId, tokens, code } = await startedGame();
    for (const token of tokens) await t.mutation(api.rooms.leave, { token, code });
    await t.mutation(internal.game.onPhaseTimeout, { gameId, turnNumber: 1, phase: 'aiming' });
    expect(await t.run((ctx) => ctx.db.query('games').first())).toBeNull();
  });

  it('auto-fires with the charged power when time runs out mid-charge', async () => {
    const { t, gameId, state, activeToken, timeout } = await startedGame();
    const token = await activeToken();
    await t.mutation(api.game.beginCharge, { token, gameId });
    expect(Math.abs((await state()).chargeStartedAt! - now)).toBeLessThan(50);
    advance(CHARGE_MS / 2);
    await timeout();
    const game = await state();
    expect(game.phase).toBe('resolving');
    const { x, y, z } = game.lastShot!.velocity;
    expect(Math.abs(Math.hypot(x, y, z) - PROJECTILE_SPEED / 2)).toBeLessThan(0.5);
  });

  it('skips an idle turn, and kills after three in a row', async () => {
    const { t, tokenOf, state, timeout } = await startedGame(2);
    const victim = (await state()).activePlayerId;
    await tokenOf(victim);
    const playerOf = async () => (await state()).players.find((p) => p.id === victim)!;
    const missed = async () =>
      (await t.run((ctx) => ctx.db.get('gamePlayers', victim as Id<'gamePlayers'>)))!.missedTurns;

    for (let count = 1; count <= 2; count++) {
      while ((await state()).activePlayerId !== victim) await timeout();
      await timeout();
      expect(await missed()).toBe(count);
      expect((await playerOf()).alive).toBe(true);
    }
    while ((await state()).activePlayerId !== victim) {
      // Keep the others alive so only the victim reaches three.
      const others = (await state()).players.map((p) => p.id).filter((id) => id !== victim);
      await t.run(async (ctx) => {
        for (const id of others) await ctx.db.patch('gamePlayers', id as Id<'gamePlayers'>, { missedTurns: 0 });
      });
      await timeout();
    }
    await timeout();
    expect((await playerOf()).alive).toBe(false);
    expect((await playerOf()).hp).toBe(0);
  });

  it('resets missed turns after a shot', async () => {
    const { t, gameId, state, activeToken, aim, timeout } = await startedGame(2);
    const victim = (await state()).activePlayerId;
    const token = await activeToken();
    await t.run((ctx) => ctx.db.patch('gamePlayers', victim as Id<'gamePlayers'>, { missedTurns: 2 }));
    await t.mutation(api.game.fire, { token, gameId, power: 0.2, ...(await aim()), pitch: 0.5 });
    await timeout('aiming');
    const stored = await t.run((ctx) => ctx.db.get('gamePlayers', victim as Id<'gamePlayers'>));
    expect(stored!.missedTurns).toBe(0);
  });

  it('gives an offline player a much shorter turn', async () => {
    const { t, state, tokens, code, timeout } = await startedGame();
    const game = await state();
    const nextId = game.players.find((p) => p.id !== game.activePlayerId)!.id;
    for (const token of tokens) {
      if ((await state(token)).myPlayerId === nextId) {
        const sessionToken = await t.mutation(api.presence.heartbeat, { token, code, sessionId: token });
        await t.mutation(api.presence.disconnect, { sessionToken });
      }
    }
    await timeout();
    const next = await state();
    expect(next.activePlayerId).toBe(nextId);
    expect(Math.abs(next.phaseEndsAt - now - OFFLINE_TURN_MS)).toBeLessThan(50);
  });
});

describe('reconnecting', () => {
  it('lets a disconnected player come back to the same game', async () => {
    const { t, state, tokens, code, idleToken } = await startedGame();
    const token = await idleToken();
    const before = await state(token);
    const sessionToken = await t.mutation(api.presence.heartbeat, { token, code, sessionId: 'tab' });
    await t.mutation(api.presence.disconnect, { sessionToken });
    await t.mutation(api.rooms.join, { token, code });
    await t.mutation(api.presence.heartbeat, { token, code, sessionId: 'new-tab' });
    const after = await state(token);
    expect(after.gameId).toBe(before.gameId);
    expect(after.myPlayerId).toBe(before.myPlayerId);
    expect(tokens).toContain(token);
  });
});

describe('ending', () => {
  const killEveryoneOn = async (ctx: Awaited<ReturnType<typeof startedGame>>, team: 'dog' | 'cat') => {
    const game = await ctx.state();
    await ctx.t.run(async (run) => {
      for (const player of game.players.filter((p) => p.team === team)) {
        await run.db.patch('gamePlayers', player.id as Id<'gamePlayers'>, { hp: 0, alive: false });
      }
    });
  };

  it('names the winner when one team is wiped out', async () => {
    const ctx = await startedGame(2);
    const game = await ctx.state();
    const loser = game.players.find((p) => p.id !== game.activePlayerId && p.team !== 'dog')?.team ?? 'cat';
    await killEveryoneOn(ctx, loser);
    await ctx.timeout();
    const end = await ctx.state();
    expect(end.status).toBe('finished');
    expect(end.winner).toBe(loser === 'cat' ? 'dog' : 'cat');
  });

  it('is a draw when both teams die', async () => {
    const ctx = await startedGame();
    const game = await ctx.state();
    const token = await ctx.activeToken();
    await ctx.t.run(async (run) => {
      for (const p of game.players) await run.db.patch('gamePlayers', p.id as Id<'gamePlayers'>, { hp: 1 });
    });
    await ctx.gatherPlayers();
    await ctx.t.mutation(api.game.fire, {
      token,
      gameId: ctx.gameId,
      power: 0.2,
      ...(await ctx.aim()),
      pitch: -1.4,
    });
    const after = await ctx.state();
    expect(after.players.every((p) => !p.alive)).toBe(true);
    await ctx.timeout();
    const end = await ctx.state();
    expect(end.status).toBe('finished');
    expect(end.winner).toBe('draw');
  });

  it('ignores actions and timeouts after the end', async () => {
    const ctx = await startedGame();
    const game = await ctx.state();
    const token = await ctx.activeToken();
    await killEveryoneOn(ctx, game.players.find((p) => p.id !== game.activePlayerId)!.team);
    await ctx.timeout();
    const end = await ctx.state();
    await ctx.t.mutation(internal.game.onPhaseTimeout, {
      gameId: ctx.gameId,
      turnNumber: end.turnNumber,
      phase: end.phase,
    });
    expect(await ctx.state()).toEqual(end);
    expect(
      await errorCode(ctx.t.mutation(api.game.fire, { token, gameId: ctx.gameId, power: 1, ...(await ctx.aim()) })),
    ).toBe('NOT_YOUR_TURN');
  });

  it('returns to the lobby with teams kept and ready cleared, deleting the match', async () => {
    const ctx = await startedGame();
    const { t, tokens, code } = ctx;
    const before = await t.query(api.rooms.view, { token: tokens[0], code });
    expect(await errorCode(t.mutation(api.rooms.backToLobby, { token: tokens[0], code }))).toBe('MATCH_NOT_OVER');

    const game = await ctx.state();
    await killEveryoneOn(ctx, game.players.find((p) => p.id !== game.activePlayerId)!.team);
    await ctx.timeout();
    await t.mutation(api.rooms.backToLobby, { token: tokens[1], code });

    const room = (await t.query(api.rooms.view, { token: tokens[0], code }))!;
    expect(room.status).toBe('lobby');
    expect(room.members.map((m) => m.team)).toEqual(before!.members.map((m) => m.team));
    expect(room.members.every((m) => !m.ready)).toBe(true);
    expect(await t.query(api.game.state, { token: tokens[0], code })).toBeNull();
    const leftovers = await t.run(async (run) => [
      await run.db.query('games').first(),
      await run.db.query('gamePlayers').first(),
      await run.db.query('shots').first(),
      await run.db.query('livePoses').first(),
    ]);
    expect(leftovers).toEqual([null, null, null, null]);

    // The same room can play again.
    await t.mutation(api.rooms.setReady, { token: tokens[1], code, ready: true });
    await t.mutation(api.rooms.start, { token: tokens[0], code });
    expect((await ctx.state()).status).toBe('active');
  });

  it('removes offline members when returning to the lobby', async () => {
    const ctx = await startedGame();
    const { t, tokens, code } = ctx;
    const sessionToken = await t.mutation(api.presence.heartbeat, {
      token: tokens[1],
      code,
      sessionId: tokens[1],
    });
    await t.mutation(api.presence.disconnect, { sessionToken });
    const game = await ctx.state();
    await killEveryoneOn(ctx, game.players.find((p) => p.id !== game.activePlayerId)!.team);
    await ctx.timeout();
    await t.mutation(api.rooms.backToLobby, { token: tokens[0], code });
    const room = (await t.query(api.rooms.view, { token: tokens[0], code }))!;
    expect(room.members).toHaveLength(1);
  });

  it('deletes the match when the last player leaves', async () => {
    const { t, tokens, code } = await startedGame();
    for (const token of tokens) await t.mutation(api.rooms.leave, { token, code });
    expect(await t.run((ctx) => ctx.db.query('gamePlayers').first())).toBeNull();
    expect(await t.run((ctx) => ctx.db.query('games').first())).toBeNull();
  });
});

import { v } from 'convex/values';
import {
  CRATER_RADIUS,
  EXPLOSION_PAUSE_MS,
  FLIGHT_MARGIN,
  MAP_HEIGHT,
  MAP_SIZE,
  MAX_HP,
  MAX_PITCH,
  MAX_PLAYERS,
  MAX_TURNS,
  MIN_POWER,
  OFFLINE_TURN_MS,
  POSE_DISTANCE_SLACK,
  POSE_MAX_RISE_SPEED,
  POSE_RISE_SLACK,
  POSE_SPEED_SLACK,
  POWER_TOLERANCE,
  RETREAT_MS,
  SPAWN_PITCH,
  TURN_MS,
  WALK_SPEED,
} from '../shared/game/constants';
import { resolveShot } from '../shared/game/explosion';
import { createBody, fallDamage, isDrowned, settleBody } from '../shared/game/player';
import { aimToVelocity, muzzlePosition, powerFromCharge, type Wind } from '../shared/game/projectile';
import { buildTerrain, generateTerrain, pickSpawns, spawnYaw, type Terrain } from '../shared/game/terrain';
import { createTurnOrder, matchOutcome, nextTurn, type TurnOrder } from '../shared/game/turns';
import { initialWind, nextWind } from '../shared/game/wind';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { fail, findGuest, requireGuest } from './guests';
import { findMember, findRoom, listOnlineGuests, touch } from './rooms';
import { phaseValidator, shotValidator, teamValidator, vec3Validator, windValidator, winnerValidator } from './schema';

type Game = Doc<'games'>;
type Pose = Doc<'livePoses'>;

async function loadPlayers(ctx: QueryCtx, gameId: Id<'games'>): Promise<Doc<'gamePlayers'>[]> {
  return await ctx.db
    .query('gamePlayers')
    .withIndex('by_gameId', (q) => q.eq('gameId', gameId))
    .take(MAX_PLAYERS);
}

async function loadShots(ctx: QueryCtx, gameId: Id<'games'>): Promise<Doc<'shots'>[]> {
  return await ctx.db
    .query('shots')
    .withIndex('by_gameId_and_turnNumber', (q) => q.eq('gameId', gameId))
    .take(MAX_TURNS + 1);
}

async function loadPose(ctx: QueryCtx, gameId: Id<'games'>): Promise<Pose> {
  const pose = await ctx.db
    .query('livePoses')
    .withIndex('by_gameId', (q) => q.eq('gameId', gameId))
    .unique();
  if (!pose) throw new Error('A game always has a live pose');
  return pose;
}

async function loadTerrain(ctx: QueryCtx, game: Game): Promise<Terrain> {
  const shots = await loadShots(ctx, game._id);
  const craters = shots.flatMap((shot) => (shot.impact ? [{ ...shot.impact, radius: CRATER_RADIUS }] : []));
  return buildTerrain(game.seed, craters);
}

/** Identity comes from the token; only the player whose turn it is gets past here. */
async function requireActivePlayer(ctx: QueryCtx, token: string, gameId: Id<'games'>) {
  const guest = await requireGuest(ctx, token);
  const game = (await ctx.db.get('games', gameId)) ?? fail('ROOM_NOT_FOUND');
  const player = await ctx.db
    .query('gamePlayers')
    .withIndex('by_gameId_and_guestId', (q) => q.eq('gameId', gameId).eq('guestId', guest._id))
    .unique();
  if (!player) fail('NOT_A_MEMBER');
  if (game.status !== 'active' || game.activePlayerId !== player._id) fail('NOT_YOUR_TURN');
  return { game, player };
}

function scheduleTimeout(ctx: MutationCtx, game: Pick<Game, '_id' | 'turnNumber' | 'phase'>, delayMs: number) {
  return ctx.scheduler.runAfter(delayMs, internal.game.onPhaseTimeout, {
    gameId: game._id,
    turnNumber: game.turnNumber,
    phase: game.phase,
  });
}

/** Called by rooms.start with the online members, who are known to fill both teams. */
export async function startMatch(
  ctx: MutationCtx,
  roomId: Id<'rooms'>,
  members: Doc<'roomMembers'>[],
): Promise<Id<'games'>> {
  // Not secret: every player's client rebuilds the same map from this seed.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const dogs = members.filter((member) => member.team === 'dog');
  const cats = members.filter((member) => member.team === 'cat');
  const spawns = pickSpawns(generateTerrain(seed), seed, dogs.length, cats.length);

  const gameId = await ctx.db.insert('games', {
    roomId,
    seed,
    status: 'active',
    winner: null,
    phase: 'aiming',
    turnNumber: 0,
    activePlayerId: '',
    phaseEndsAt: 0,
    chargeStartedAt: null,
    wind: initialWind(seed),
    order: { dog: [], cat: [], dogIndex: 0, catIndex: 0, nextTeam: 'dog' },
  });

  const addTeam = async (team: 'dog' | 'cat', list: Doc<'roomMembers'>[], spots: typeof spawns.dog) => {
    const ids: string[] = [];
    for (const [i, member] of list.entries()) {
      const guest = await ctx.db.get('guests', member.guestId);
      const spot = spots[i];
      ids.push(
        await ctx.db.insert('gamePlayers', {
          gameId,
          guestId: member.guestId,
          team,
          name: guest?.name ?? '?',
          hp: MAX_HP,
          alive: true,
          missedTurns: 0,
          ...spot,
          yaw: spawnYaw(spot),
          pitch: SPAWN_PITCH,
        }),
      );
    }
    return ids;
  };
  const dogIds = await addTeam('dog', dogs, spawns.dog);
  const catIds = await addTeam('cat', cats, spawns.cat);

  const first = nextTurn(createTurnOrder(seed, dogIds, catIds), () => true);
  if (!first) throw new Error('A match needs players');
  const player = (await loadPlayers(ctx, gameId)).find((p) => p._id === first.playerId)!;
  await ctx.db.insert('livePoses', {
    gameId,
    playerId: first.playerId,
    turnNumber: 1,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    grounded: true,
    peakY: player.y,
    updatedAt: Date.now(),
  });
  const game = (await ctx.db.get('games', gameId))!;
  await beginTurn(ctx, game, first.playerId, first.order, 1, game.wind);
  return gameId;
}

async function beginTurn(
  ctx: MutationCtx,
  game: Game,
  playerId: string,
  order: TurnOrder,
  turnNumber: number,
  wind: Wind,
) {
  const players = await loadPlayers(ctx, game._id);
  const player = players.find((p) => p._id === playerId)!;
  const online = await listOnlineGuests(ctx, game.roomId);
  const duration = online.has(player.guestId) ? TURN_MS : OFFLINE_TURN_MS;
  const now = Date.now();
  await ctx.db.patch('games', game._id, {
    phase: 'aiming',
    turnNumber,
    activePlayerId: playerId,
    phaseEndsAt: now + duration,
    chargeStartedAt: null,
    wind,
    order,
  });
  const pose = await loadPose(ctx, game._id);
  await ctx.db.patch('livePoses', pose._id, {
    playerId,
    turnNumber,
    x: player.x,
    y: player.y,
    z: player.z,
    yaw: player.yaw,
    pitch: player.pitch,
    grounded: true,
    peakY: player.y,
    updatedAt: now,
  });
  await scheduleTimeout(ctx, { _id: game._id, turnNumber, phase: 'aiming' }, duration);
  await touch(ctx, game.roomId);
}

async function finishMatch(ctx: MutationCtx, game: Game, winner: 'dog' | 'cat' | 'draw') {
  await ctx.db.patch('games', game._id, { status: 'finished', winner, chargeStartedAt: null });
}

function outcomeOf(game: Game, players: Doc<'gamePlayers'>[]) {
  const alive = (team: 'dog' | 'cat') => players.filter((p) => p.team === team && p.alive).length;
  return matchOutcome(alive('dog'), alive('cat'), game.turnNumber);
}

/** Settles the active player where they stopped, then hands over or ends the match. */
async function endTurn(ctx: MutationCtx, game: Game) {
  const active = (await loadPlayers(ctx, game._id)).find((p) => p._id === game.activePlayerId)!;
  if (active.alive) {
    const pose = await loadPose(ctx, game._id);
    const settled = settleBody(await loadTerrain(ctx, game), createBody(pose));
    const hp = settled.drowned ? 0 : Math.max(0, active.hp - settled.fallDamage);
    await ctx.db.patch('gamePlayers', active._id, {
      x: settled.x,
      y: settled.y,
      z: settled.z,
      yaw: pose.yaw,
      pitch: pose.pitch,
      hp,
      alive: hp > 0,
    });
  }

  const players = await loadPlayers(ctx, game._id);
  const outcome = outcomeOf(game, players);
  if (outcome) return await finishMatch(ctx, game, outcome);
  const next = nextTurn(game.order, (id) => players.some((p) => p._id === id && p.alive));
  if (!next) return await finishMatch(ctx, game, 'draw');
  const turnNumber = game.turnNumber + 1;
  await beginTurn(ctx, game, next.playerId, next.order, turnNumber, nextWind(game.seed, turnNumber, game.wind));
}

async function killActive(ctx: MutationCtx, game: Game, playerId: Id<'gamePlayers'>) {
  await ctx.db.patch('gamePlayers', playerId, { hp: 0, alive: false });
  await endTurn(ctx, game);
}

/** Fires for the active player. `power` has already been limited to what they could have charged. */
async function performShot(ctx: MutationCtx, game: Game, pose: Pose, power: number) {
  const players = await loadPlayers(ctx, game._id);
  const shooter = players.find((p) => p._id === game.activePlayerId)!;
  const origin = muzzlePosition(pose, pose.yaw, pose.pitch);
  const velocity = aimToVelocity(pose.yaw, pose.pitch, power);

  // Everyone's position is the stored one, except the shooter who has been walking.
  await ctx.db.patch('gamePlayers', shooter._id, {
    x: pose.x,
    y: pose.y,
    z: pose.z,
    yaw: pose.yaw,
    pitch: pose.pitch,
    missedTurns: 0,
  });
  const targets = players
    .filter((p) => p.alive)
    .map((p) => (p._id === shooter._id ? { id: p._id, x: pose.x, y: pose.y, z: pose.z, hp: p.hp } : toTarget(p)));
  const result = resolveShot({
    terrain: await loadTerrain(ctx, game),
    shooterId: shooter._id,
    origin,
    velocity,
    wind: game.wind,
    players: targets,
  });

  await ctx.db.insert('shots', {
    gameId: game._id,
    turnNumber: game.turnNumber,
    origin,
    velocity,
    wind: game.wind,
    flightMs: result.flightMs,
    impact: result.impact,
    hits: result.hits,
  });
  for (const hit of result.hits) {
    const hitPlayer = players.find((p) => p._id === hit.playerId)!;
    await ctx.db.patch('gamePlayers', hitPlayer._id, { ...hit.finalPos, hp: hit.hpAfter, alive: !hit.died });
    if (hit.playerId === shooter._id) {
      await ctx.db.patch('livePoses', pose._id, { ...hit.finalPos, peakY: hit.finalPos.y, grounded: true });
    }
  }

  const delay = result.flightMs + EXPLOSION_PAUSE_MS;
  await ctx.db.patch('games', game._id, {
    phase: 'resolving',
    phaseEndsAt: Date.now() + delay,
    chargeStartedAt: null,
  });
  await scheduleTimeout(ctx, { _id: game._id, turnNumber: game.turnNumber, phase: 'resolving' }, delay);
}

function toTarget(player: Doc<'gamePlayers'>) {
  return { id: player._id, x: player.x, y: player.y, z: player.z, hp: player.hp };
}

type PoseArgs = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
};

/**
 * Rejects positions the player couldn't have reached since the last accepted one.
 * ponytail: positions are still client-reported and not checked against voxels, so a
 * modified client could walk through walls. Fine among friends; a public game would
 * need to simulate movement on the server.
 */
function isReachable(pose: Pose, next: PoseArgs, now: number): boolean {
  const values = [next.x, next.y, next.z, next.yaw, next.pitch];
  if (!values.every(Number.isFinite)) return false;
  const inside = (value: number) => value >= -FLIGHT_MARGIN && value <= MAP_SIZE + FLIGHT_MARGIN;
  if (!inside(next.x) || !inside(next.z) || next.y < 0 || next.y > MAP_HEIGHT + FLIGHT_MARGIN) return false;
  const seconds = Math.max(0, now - pose.updatedAt) / 1000;
  const walked = Math.hypot(next.x - pose.x, next.z - pose.z);
  if (walked > WALK_SPEED * POSE_SPEED_SLACK * seconds + POSE_DISTANCE_SLACK) return false;
  return next.y - pose.y <= POSE_MAX_RISE_SPEED * seconds + POSE_RISE_SLACK;
}

const poseArgs = {
  x: v.number(),
  y: v.number(),
  z: v.number(),
  yaw: v.number(),
  pitch: v.number(),
  grounded: v.boolean(),
};

/** Stores a reachable pose. Returns the fall damage from landing, if any. */
async function applyPose(ctx: MutationCtx, pose: Pose, next: PoseArgs): Promise<number> {
  const now = Date.now();
  if (!isReachable(pose, next, now)) return 0;
  const landed = next.grounded && !pose.grounded;
  const peakY = next.grounded && !landed ? next.y : Math.max(pose.peakY, next.y);
  await ctx.db.patch('livePoses', pose._id, {
    x: next.x,
    y: next.y,
    z: next.z,
    yaw: next.yaw,
    pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, next.pitch)),
    grounded: next.grounded,
    peakY: landed ? next.y : peakY,
    updatedAt: now,
  });
  return landed ? fallDamage(peakY - next.y) : 0;
}

export const updatePose = mutation({
  args: { token: v.string(), gameId: v.id('games'), turnNumber: v.number(), ...poseArgs },
  returns: v.null(),
  handler: async (ctx, { token, gameId, turnNumber, ...next }) => {
    const { game, player } = await requireActivePlayer(ctx, token, gameId);
    // A pose sent just before the phase changed is stale rather than wrong, so ignore it quietly.
    if (game.turnNumber !== turnNumber || game.phase === 'resolving') return null;
    const pose = await loadPose(ctx, gameId);
    const damage = await applyPose(ctx, pose, next);
    const updated = await loadPose(ctx, gameId);
    if (isDrowned(updated.y)) {
      await killActive(ctx, game, player._id);
    } else if (damage > 0) {
      const hp = Math.max(0, player.hp - damage);
      if (hp === 0) await killActive(ctx, game, player._id);
      else await ctx.db.patch('gamePlayers', player._id, { hp });
    }
    return null;
  },
});

export const beginCharge = mutation({
  args: { token: v.string(), gameId: v.id('games') },
  returns: v.null(),
  handler: async (ctx, { token, gameId }) => {
    const { game } = await requireActivePlayer(ctx, token, gameId);
    if (game.phase !== 'aiming') fail('WRONG_PHASE');
    if (game.chargeStartedAt === null) await ctx.db.patch('games', gameId, { chargeStartedAt: Date.now() });
    return null;
  },
});

export const fire = mutation({
  args: { token: v.string(), gameId: v.id('games'), power: v.number(), ...poseArgs },
  returns: v.null(),
  handler: async (ctx, { token, gameId, power, ...next }) => {
    const { game } = await requireActivePlayer(ctx, token, gameId);
    if (game.phase !== 'aiming') fail('WRONG_PHASE');
    if (![power, next.yaw, next.pitch].every(Number.isFinite)) fail('INVALID_AIM');
    await applyPose(ctx, await loadPose(ctx, gameId), next);
    // Limited, not refused: a little network delay shouldn't cost a turn.
    const charged = game.chargeStartedAt === null ? MIN_POWER : powerFromCharge(Date.now() - game.chargeStartedAt);
    await performShot(ctx, game, await loadPose(ctx, gameId), Math.min(power, charged + POWER_TOLERANCE));
    return null;
  },
});

/** Scheduled for every phase. Does nothing if the game has moved on, so running late or twice is safe. */
export const onPhaseTimeout = internalMutation({
  args: { gameId: v.id('games'), turnNumber: v.number(), phase: phaseValidator },
  returns: v.null(),
  handler: async (ctx, { gameId, turnNumber, phase }) => {
    const game = await ctx.db.get('games', gameId);
    if (!game || game.status !== 'active' || game.turnNumber !== turnNumber || game.phase !== phase) return null;
    const players = await loadPlayers(ctx, gameId);
    const active = players.find((p) => p._id === game.activePlayerId)!;

    if (phase === 'aiming') {
      if (game.chargeStartedAt !== null) {
        const power = powerFromCharge(Date.now() - game.chargeStartedAt);
        await performShot(ctx, game, await loadPose(ctx, gameId), power);
        return null;
      }
      const missedTurns = active.missedTurns + 1;
      if (missedTurns >= 3) {
        await ctx.db.patch('gamePlayers', active._id, { missedTurns });
        await killActive(ctx, game, active._id);
      } else {
        await ctx.db.patch('gamePlayers', active._id, { missedTurns });
        await endTurn(ctx, game);
      }
      return null;
    }

    if (phase === 'resolving') {
      const outcome = outcomeOf(game, players);
      if (outcome) {
        await finishMatch(ctx, game, outcome);
      } else if (active.alive) {
        await ctx.db.patch('games', gameId, { phase: 'retreat', phaseEndsAt: Date.now() + RETREAT_MS });
        const pose = await loadPose(ctx, gameId);
        await ctx.db.patch('livePoses', pose._id, { updatedAt: Date.now() });
        await scheduleTimeout(ctx, { _id: gameId, turnNumber, phase: 'retreat' }, RETREAT_MS);
      } else {
        await endTurn(ctx, game);
      }
      return null;
    }

    await endTurn(ctx, game);
    return null;
  },
});

/** Everything a client needs, in one query so the state it sees is always consistent. */
export const state = query({
  args: { token: v.string(), code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      gameId: v.id('games'),
      seed: v.number(),
      status: v.union(v.literal('active'), v.literal('finished')),
      winner: winnerValidator,
      phase: phaseValidator,
      turnNumber: v.number(),
      activePlayerId: v.string(),
      phaseEndsAt: v.number(),
      chargeStartedAt: v.union(v.number(), v.null()),
      wind: windValidator,
      order: v.object({
        dog: v.array(v.string()),
        cat: v.array(v.string()),
        dogIndex: v.number(),
        catIndex: v.number(),
        nextTeam: teamValidator,
      }),
      myPlayerId: v.union(v.string(), v.null()),
      players: v.array(
        v.object({
          id: v.string(),
          team: teamValidator,
          name: v.string(),
          hp: v.number(),
          alive: v.boolean(),
          x: v.number(),
          y: v.number(),
          z: v.number(),
          yaw: v.number(),
          pitch: v.number(),
        }),
      ),
      craters: v.array(vec3Validator),
      lastShot: v.union(shotValidator, v.null()),
    }),
  ),
  handler: async (ctx, { token, code }) => {
    const guest = await findGuest(ctx, token);
    const room = await findRoom(ctx, code);
    if (!guest || !room?.currentGameId || !(await findMember(ctx, room._id, guest._id))) return null;
    const game = await ctx.db.get('games', room.currentGameId);
    if (!game) return null;
    const players = await loadPlayers(ctx, game._id);
    const shots = await loadShots(ctx, game._id);
    const last = shots[shots.length - 1];
    return {
      gameId: game._id,
      seed: game.seed,
      status: game.status,
      winner: game.winner,
      phase: game.phase,
      turnNumber: game.turnNumber,
      activePlayerId: game.activePlayerId,
      phaseEndsAt: game.phaseEndsAt,
      chargeStartedAt: game.chargeStartedAt,
      wind: game.wind,
      order: game.order,
      myPlayerId: players.find((p) => p.guestId === guest._id)?._id ?? null,
      players: players.map((p) => ({
        id: p._id,
        team: p.team,
        name: p.name,
        hp: p.hp,
        alive: p.alive,
        x: p.x,
        y: p.y,
        z: p.z,
        yaw: p.yaw,
        pitch: p.pitch,
      })),
      craters: shots.flatMap((shot) => (shot.impact ? [shot.impact] : [])),
      lastShot: last
        ? {
            turnNumber: last.turnNumber,
            origin: last.origin,
            velocity: last.velocity,
            wind: last.wind,
            flightMs: last.flightMs,
            impact: last.impact,
            hits: last.hits,
          }
        : null,
    };
  },
});

/**
 * The active player's live position. Takes no token on purpose: identical arguments let
 * every watcher share one cached result, and this is what runs several times a second.
 * It exposes only a position in a game whose unguessable id only its members receive.
 */
export const pose = query({
  args: { gameId: v.id('games') },
  returns: v.union(
    v.null(),
    v.object({
      playerId: v.string(),
      turnNumber: v.number(),
      x: v.number(),
      y: v.number(),
      z: v.number(),
      yaw: v.number(),
      pitch: v.number(),
      grounded: v.boolean(),
    }),
  ),
  handler: async (ctx, { gameId }) => {
    const live = await ctx.db
      .query('livePoses')
      .withIndex('by_gameId', (q) => q.eq('gameId', gameId))
      .unique();
    if (!live) return null;
    const { playerId, turnNumber, x, y, z, yaw, pitch, grounded } = live;
    return { playerId, turnNumber, x, y, z, yaw, pitch, grounded };
  },
});

/** Lets a client work out how far its clock is from the server's, for a countdown that survives rejoining. */
export const serverTime = mutation({
  args: {},
  returns: v.number(),
  handler: async () => Date.now(),
});

export async function deleteGame(ctx: MutationCtx, gameId: Id<'games'>) {
  for (const player of await loadPlayers(ctx, gameId)) await ctx.db.delete('gamePlayers', player._id);
  for (const shot of await loadShots(ctx, gameId)) await ctx.db.delete('shots', shot._id);
  const live = await ctx.db
    .query('livePoses')
    .withIndex('by_gameId', (q) => q.eq('gameId', gameId))
    .unique();
  if (live) await ctx.db.delete('livePoses', live._id);
  if (await ctx.db.get('games', gameId)) await ctx.db.delete('games', gameId);
}

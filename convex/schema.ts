import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const teamValidator = v.union(v.literal('dog'), v.literal('cat'));
export const vec3Validator = v.object({ x: v.number(), y: v.number(), z: v.number() });
export const windValidator = v.object({ x: v.number(), z: v.number() });
export const phaseValidator = v.union(v.literal('aiming'), v.literal('resolving'), v.literal('retreat'));
export const winnerValidator = v.union(v.literal('dog'), v.literal('cat'), v.literal('draw'), v.null());
export const shotValidator = v.object({
  turnNumber: v.number(),
  origin: vec3Validator,
  velocity: vec3Validator,
  wind: windValidator,
  flightMs: v.number(),
  impact: v.union(vec3Validator, v.null()),
  hits: v.array(
    v.object({
      playerId: v.string(),
      damage: v.number(),
      knockback: vec3Validator,
      finalPos: vec3Validator,
      hpAfter: v.number(),
      died: v.boolean(),
    }),
  ),
});

export default defineSchema({
  // tokenHash is the only proof of identity. Never return it, or anything derived from it, to a client.
  guests: defineTable({
    tokenHash: v.string(),
    name: v.string(),
  }).index('by_tokenHash', ['tokenHash']),

  rooms: defineTable({
    code: v.string(),
    status: v.union(v.literal('lobby'), v.literal('playing')),
    lastActivityAt: v.number(),
    currentGameId: v.optional(v.id('games')),
  })
    .index('by_code', ['code'])
    .index('by_lastActivityAt', ['lastActivityAt']),

  // _creationTime is the join order, which also decides who is host.
  roomMembers: defineTable({
    roomId: v.id('rooms'),
    guestId: v.id('guests'),
    team: teamValidator,
    ready: v.boolean(),
  })
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes -- This one keeps join order, which picks the host.
    .index('by_roomId', ['roomId'])
    .index('by_roomId_and_guestId', ['roomId', 'guestId']),

  games: defineTable({
    roomId: v.id('rooms'),
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
  }),

  gamePlayers: defineTable({
    gameId: v.id('games'),
    guestId: v.id('guests'),
    team: teamValidator,
    name: v.string(),
    hp: v.number(),
    alive: v.boolean(),
    missedTurns: v.number(),
    x: v.number(),
    y: v.number(),
    z: v.number(),
    yaw: v.number(),
    pitch: v.number(),
  })
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes -- Listing all players never needs the guestId sort.
    .index('by_gameId', ['gameId'])
    .index('by_gameId_and_guestId', ['gameId', 'guestId']),

  // An explosion is a shot with an impact, so terrain is the seed plus these. Bounded by MAX_TURNS.
  shots: defineTable({ gameId: v.id('games'), ...shotValidator.fields }).index('by_gameId_and_turnNumber', [
    'gameId',
    'turnNumber',
  ]),

  // Changes several times a second, so it lives apart from `games` to keep that document's readers quiet.
  livePoses: defineTable({
    gameId: v.id('games'),
    playerId: v.string(),
    turnNumber: v.number(),
    x: v.number(),
    y: v.number(),
    z: v.number(),
    yaw: v.number(),
    pitch: v.number(),
    grounded: v.boolean(),
    peakY: v.number(),
    updatedAt: v.number(),
    // The sender's own clock, only for other clients to replay movement evenly. Never trusted for anything else.
    sentAt: v.optional(v.number()),
  }).index('by_gameId', ['gameId']),
});

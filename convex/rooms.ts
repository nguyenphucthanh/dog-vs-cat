import { v } from 'convex/values';
import { MAX_PLAYERS, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, ROOM_IDLE_MS } from '../shared/game/constants';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { fail, findGuest, requireGuest } from './guests';
import { deleteGame, startMatch } from './game';
import { presence } from './presence';
import { teamValidator } from './schema';

const CLEANUP_BATCH = 50;

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function findRoom(ctx: QueryCtx, code: string): Promise<Doc<'rooms'> | null> {
  return await ctx.db
    .query('rooms')
    .withIndex('by_code', (q) => q.eq('code', normalizeCode(code)))
    .unique();
}

export async function findMember(
  ctx: QueryCtx,
  roomId: Id<'rooms'>,
  guestId: Id<'guests'>,
): Promise<Doc<'roomMembers'> | null> {
  return await ctx.db
    .query('roomMembers')
    .withIndex('by_roomId_and_guestId', (q) => q.eq('roomId', roomId).eq('guestId', guestId))
    .unique();
}

export async function listMembers(ctx: QueryCtx, roomId: Id<'rooms'>): Promise<Doc<'roomMembers'>[]> {
  return await ctx.db
    .query('roomMembers')
    .withIndex('by_roomId', (q) => q.eq('roomId', roomId))
    .take(MAX_PLAYERS);
}

export async function listOnlineGuests(ctx: QueryCtx, roomId: Id<'rooms'>): Promise<Set<string>> {
  const online = await presence.listRoom(ctx, roomId, true, MAX_PLAYERS);
  return new Set(online.map((entry) => entry.userId));
}

/** The earliest joiner still online, so hosting passes on by itself when someone leaves or drops. */
function pickHost(members: Doc<'roomMembers'>[], online: Set<string>): Doc<'roomMembers'> | null {
  return members.find((member) => online.has(member.guestId)) ?? members[0] ?? null;
}

/** Why the room can't start yet, or null if it can. Offline players neither block nor count. */
function startProblem(members: Doc<'roomMembers'>[], online: Set<string>) {
  const present = members.filter((member) => online.has(member.guestId));
  const host = pickHost(members, online);
  if (!present.some((m) => m.team === 'dog') || !present.some((m) => m.team === 'cat')) return 'TEAM_EMPTY' as const;
  if (present.some((m) => m._id !== host?._id && !m.ready)) return 'NOT_EVERYONE_READY' as const;
  return null;
}

async function requireMembership(ctx: QueryCtx, token: string, code: string) {
  const guest = await requireGuest(ctx, token);
  const room = (await findRoom(ctx, code)) ?? fail('ROOM_NOT_FOUND');
  const member = (await findMember(ctx, room._id, guest._id)) ?? fail('NOT_A_MEMBER');
  return { guest, room, member };
}

export async function touch(ctx: MutationCtx, roomId: Id<'rooms'>) {
  await ctx.db.patch('rooms', roomId, { lastActivityAt: Date.now() });
}

async function generateUniqueCode(ctx: QueryCtx): Promise<string> {
  for (;;) {
    // Sharing the code is how friends get in, so it only needs to be hard to stumble on by accident.
    // ponytail: guessing is possible, and nothing limits attempts. Add rate limiting before going public.
    const code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)],
    ).join('');
    if (!(await findRoom(ctx, code))) return code;
  }
}

export const create = mutation({
  args: { token: v.string() },
  returns: v.string(),
  handler: async (ctx, { token }) => {
    const guest = await requireGuest(ctx, token);
    const code = await generateUniqueCode(ctx);
    const roomId = await ctx.db.insert('rooms', { code, status: 'lobby', lastActivityAt: Date.now() });
    await ctx.db.insert('roomMembers', { roomId, guestId: guest._id, team: 'dog', ready: false });
    return code;
  },
});

/** Safe to repeat: someone already in the room simply stays, even once the match is running. */
export const join = mutation({
  args: { token: v.string(), code: v.string() },
  returns: v.string(),
  handler: async (ctx, { token, code }) => {
    const guest = await requireGuest(ctx, token);
    const room = (await findRoom(ctx, code)) ?? fail('ROOM_NOT_FOUND');
    if (await findMember(ctx, room._id, guest._id)) return room.code;
    if (room.status !== 'lobby') fail('ROOM_IN_PROGRESS');
    const members = await listMembers(ctx, room._id);
    if (members.length >= MAX_PLAYERS) {
      // Someone who left without saying so shouldn't hold a seat against a person who is here.
      const online = await listOnlineGuests(ctx, room._id);
      const absent = members.find((member) => !online.has(member.guestId)) ?? fail('ROOM_FULL');
      await ctx.db.delete('roomMembers', absent._id);
      members.splice(members.indexOf(absent), 1);
    }
    const dogs = members.filter((member) => member.team === 'dog').length;
    const team = dogs <= members.length - dogs ? 'dog' : 'cat';
    await ctx.db.insert('roomMembers', { roomId: room._id, guestId: guest._id, team, ready: false });
    await touch(ctx, room._id);
    return room.code;
  },
});

export const leave = mutation({
  args: { token: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, code }) => {
    const { guest, room, member } = await requireMembership(ctx, token, code);
    await ctx.db.delete('roomMembers', member._id);
    await presence.removeRoomUser(ctx, room._id, guest._id);
    const remaining = await listMembers(ctx, room._id);
    if (remaining.length === 0) {
      if (room.currentGameId) await deleteGame(ctx, room.currentGameId);
      await ctx.db.delete('rooms', room._id);
    } else {
      await touch(ctx, room._id);
    }
    return null;
  },
});

export const setTeam = mutation({
  args: { token: v.string(), code: v.string(), team: teamValidator },
  returns: v.null(),
  handler: async (ctx, { token, code, team }) => {
    const { room, member } = await requireMembership(ctx, token, code);
    if (room.status !== 'lobby') fail('ROOM_IN_PROGRESS');
    await ctx.db.patch('roomMembers', member._id, { team, ready: false });
    await touch(ctx, room._id);
    return null;
  },
});

export const setReady = mutation({
  args: { token: v.string(), code: v.string(), ready: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { token, code, ready }) => {
    const { room, member } = await requireMembership(ctx, token, code);
    if (room.status !== 'lobby') fail('ROOM_IN_PROGRESS');
    await ctx.db.patch('roomMembers', member._id, { ready });
    await touch(ctx, room._id);
    return null;
  },
});

export const start = mutation({
  args: { token: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, code }) => {
    const { room, member } = await requireMembership(ctx, token, code);
    if (room.status !== 'lobby') fail('ROOM_IN_PROGRESS');
    const members = await listMembers(ctx, room._id);
    const online = await listOnlineGuests(ctx, room._id);
    if (pickHost(members, online)?._id !== member._id) fail('NOT_THE_HOST');
    const problem = startProblem(members, online);
    if (problem) fail(problem);
    for (const other of members) {
      if (!online.has(other.guestId)) await ctx.db.delete('roomMembers', other._id);
    }
    const gameId = await startMatch(
      ctx,
      room._id,
      members.filter((other) => online.has(other.guestId)),
    );
    await ctx.db.patch('rooms', room._id, { status: 'playing', currentGameId: gameId, lastActivityAt: Date.now() });
    return null;
  },
});

/** Ends the results screen for the whole room. Teams stay, nothing about the match is kept. */
export const backToLobby = mutation({
  args: { token: v.string(), code: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, code }) => {
    const { room } = await requireMembership(ctx, token, code);
    const game = room.currentGameId ? await ctx.db.get('games', room.currentGameId) : null;
    if (game?.status !== 'finished') fail('MATCH_NOT_OVER');
    await deleteGame(ctx, game._id);
    const online = await listOnlineGuests(ctx, room._id);
    for (const member of await listMembers(ctx, room._id)) {
      if (online.has(member.guestId)) await ctx.db.patch('roomMembers', member._id, { ready: false });
      else await ctx.db.delete('roomMembers', member._id);
    }
    await ctx.db.patch('rooms', room._id, { status: 'lobby', currentGameId: undefined, lastActivityAt: Date.now() });
    return null;
  },
});

export const view = query({
  args: { token: v.string(), code: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      code: v.string(),
      status: v.union(v.literal('lobby'), v.literal('playing')),
      isMember: v.boolean(),
      isFull: v.boolean(),
      startProblem: v.union(v.null(), v.literal('TEAM_EMPTY'), v.literal('NOT_EVERYONE_READY')),
      members: v.array(
        v.object({
          id: v.id('roomMembers'),
          name: v.string(),
          team: teamValidator,
          ready: v.boolean(),
          online: v.boolean(),
          isHost: v.boolean(),
          isMe: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { token, code }) => {
    const room = await findRoom(ctx, code);
    if (!room) return null;
    const guest = await findGuest(ctx, token);
    const members = await listMembers(ctx, room._id);
    const online = await listOnlineGuests(ctx, room._id);
    const host = pickHost(members, online);
    // Someone arriving by link or a lucky guess sees whether they can join, but not who is inside.
    const isMember = guest !== null && members.some((member) => member.guestId === guest._id);
    const visible = isMember ? members : [];
    const views = await Promise.all(
      visible.map(async (member) => {
        const profile = await ctx.db.get('guests', member.guestId);
        return {
          id: member._id,
          name: profile?.name ?? '?',
          team: member.team,
          ready: member.ready,
          online: online.has(member.guestId),
          isHost: member._id === host?._id,
          isMe: member.guestId === guest?._id,
        };
      }),
    );
    return {
      code: room.code,
      status: room.status,
      isMember,
      isFull: members.length >= MAX_PLAYERS,
      startProblem: isMember ? startProblem(members, online) : null,
      members: views,
    };
  },
});

/** Deletes rooms nobody has touched for a while, unless someone is still sitting in them. */
export const cleanupIdle = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - ROOM_IDLE_MS;
    const rooms = await ctx.db
      .query('rooms')
      .withIndex('by_lastActivityAt', (q) => q.lt('lastActivityAt', cutoff))
      .take(CLEANUP_BATCH);
    for (const room of rooms) {
      const online = await listOnlineGuests(ctx, room._id);
      if (online.size > 0) {
        await touch(ctx, room._id);
        continue;
      }
      for (const member of await listMembers(ctx, room._id)) {
        await presence.removeRoomUser(ctx, room._id, member.guestId);
        await ctx.db.delete('roomMembers', member._id);
      }
      if (room.currentGameId) await deleteGame(ctx, room.currentGameId);
      await ctx.db.delete('rooms', room._id);
    }
    if (rooms.length === CLEANUP_BATCH) await ctx.scheduler.runAfter(0, internal.rooms.cleanupIdle, {});
    return null;
  },
});

/// <reference types="vite/client" />
import presenceTest from '@convex-dev/presence/test';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PLAYERS, ROOM_IDLE_MS } from '../shared/game/constants';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function setup() {
  const t = convexTest(schema, modules);
  presenceTest.register(t);
  const newGuest = async (name: string) => {
    const token = crypto.randomUUID();
    await t.mutation(api.guests.create, { token, name });
    return token;
  };
  const beOnline = (token: string, code: string) =>
    t.mutation(api.presence.heartbeat, { token, code, sessionId: token });
  const view = async (token: string, code: string) => (await t.query(api.rooms.view, { token, code }))!;
  /** A host with one online opponent on the other team, both connected. */
  const twoPlayerRoom = async () => {
    const host = await newGuest('Host');
    const other = await newGuest('Other');
    const code = await t.mutation(api.rooms.create, { token: host });
    await t.mutation(api.rooms.join, { token: other, code });
    await beOnline(host, code);
    await beOnline(other, code);
    return { host, other, code };
  };
  return { t, newGuest, beOnline, view, twoPlayerRoom };
}

/** Awaits a call that must fail, and returns its error code. */
async function errorCode(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    if (error instanceof ConvexError) return error.data;
    throw error;
  }
  throw new Error('Expected the call to fail');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('guests', () => {
  it('stores only a hash of the token and never returns it', async () => {
    const { t, newGuest, view } = setup();
    const token = await newGuest('Mimi');
    const stored = await t.run((ctx) => ctx.db.query('guests').first());
    expect(stored!.tokenHash).not.toContain(token);
    expect(stored!.tokenHash).toHaveLength(64);

    const code = await t.mutation(api.rooms.create, { token });
    const everything = JSON.stringify([await t.query(api.guests.me, { token }), await view(token, code)]);
    expect(everything).not.toContain(token);
    expect(everything).not.toContain(stored!.tokenHash);
    expect(everything).not.toContain(stored!._id);
  });

  it.each(['', '   ', 'x'.repeat(17)])('rejects the name %j', async (name) => {
    const { t } = setup();
    expect(await errorCode(t.mutation(api.guests.create, { token: crypto.randomUUID(), name }))).toBe('INVALID_NAME');
  });

  it('trims names, allows duplicates and counts characters rather than UTF-16 units', async () => {
    const { t, newGuest } = setup();
    const a = await newGuest('  Mèo  ');
    const b = await newGuest('Mèo');
    expect(await t.query(api.guests.me, { token: a })).toEqual({ name: 'Mèo' });
    expect(await t.query(api.guests.me, { token: b })).toEqual({ name: 'Mèo' });
    await newGuest('🐱'.repeat(16));
  });

  it('refuses a short token or one already taken', async () => {
    const { t, newGuest } = setup();
    expect(await errorCode(t.mutation(api.guests.create, { token: 'short', name: 'A' }))).toBe('INVALID_TOKEN');
    const taken = await newGuest('A');
    expect(await errorCode(t.mutation(api.guests.create, { token: taken, name: 'B' }))).toBe('INVALID_TOKEN');
  });

  it('shows a rename in the room', async () => {
    const { t, newGuest, view } = setup();
    const token = await newGuest('Old');
    const code = await t.mutation(api.rooms.create, { token });
    await t.mutation(api.guests.rename, { token, name: 'New' });
    expect((await view(token, code)).members[0].name).toBe('New');
  });
});

describe('every room action needs a real guest', () => {
  const FAKE = '00000000-0000-4000-8000-000000000000';

  it('rejects unknown tokens', async () => {
    const { t, twoPlayerRoom } = setup();
    const { code } = await twoPlayerRoom();
    const calls = [
      t.mutation(api.rooms.create, { token: FAKE }),
      t.mutation(api.rooms.join, { token: FAKE, code }),
      t.mutation(api.rooms.leave, { token: FAKE, code }),
      t.mutation(api.rooms.setTeam, { token: FAKE, code, team: 'cat' }),
      t.mutation(api.rooms.setReady, { token: FAKE, code, ready: true }),
      t.mutation(api.rooms.start, { token: FAKE, code }),
      t.mutation(api.presence.heartbeat, { token: FAKE, code, sessionId: 's' }),
      t.mutation(api.guests.rename, { token: FAKE, name: 'X' }),
    ];
    for (const call of calls) expect(await errorCode(call)).toBe('UNKNOWN_GUEST');
  });

  it('rejects guests who are not in the room', async () => {
    const { t, newGuest, twoPlayerRoom } = setup();
    const { code } = await twoPlayerRoom();
    const outsider = await newGuest('Outsider');
    const calls = [
      t.mutation(api.rooms.leave, { token: outsider, code }),
      t.mutation(api.rooms.setTeam, { token: outsider, code, team: 'cat' }),
      t.mutation(api.rooms.setReady, { token: outsider, code, ready: true }),
      t.mutation(api.rooms.start, { token: outsider, code }),
      t.mutation(api.presence.heartbeat, { token: outsider, code, sessionId: 's' }),
    ];
    for (const call of calls) expect(await errorCode(call)).toBe('NOT_A_MEMBER');
  });
});

describe('joining', () => {
  it('makes a room with a 5 character code that avoids look-alike characters', async () => {
    const { t, newGuest } = setup();
    const code = await t.mutation(api.rooms.create, { token: await newGuest('A') });
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  });

  it('accepts a lower-case code with stray spaces', async () => {
    const { t, newGuest, view } = setup();
    const code = await t.mutation(api.rooms.create, { token: await newGuest('A') });
    const token = await newGuest('B');
    expect(await t.mutation(api.rooms.join, { token, code: ` ${code.toLowerCase()} ` })).toBe(code);
    expect((await view(token, code)).isMember).toBe(true);
  });

  it('fails on a wrong code', async () => {
    const { t, newGuest } = setup();
    const token = await newGuest('A');
    expect(await errorCode(t.mutation(api.rooms.join, { token, code: 'ZZZZZ' }))).toBe('ROOM_NOT_FOUND');
    expect(await t.query(api.rooms.view, { token, code: 'ZZZZZ' })).toBeNull();
  });

  it('puts newcomers on the smaller team', async () => {
    const { t, newGuest, view } = setup();
    const host = await newGuest('H');
    const code = await t.mutation(api.rooms.create, { token: host });
    for (const name of ['A', 'B', 'C']) await t.mutation(api.rooms.join, { token: await newGuest(name), code });
    expect((await view(host, code)).members.map((m) => m.team)).toEqual(['dog', 'cat', 'dog', 'cat']);
  });

  it('shows the room but not who is in it to someone outside', async () => {
    const { t, newGuest, twoPlayerRoom } = setup();
    const { code } = await twoPlayerRoom();
    for (const token of [await newGuest('Outsider'), 'not-a-real-token']) {
      const room = (await t.query(api.rooms.view, { token, code }))!;
      expect(room).toMatchObject({ code, isMember: false, members: [], startProblem: null });
    }
  });

  it("gives an offline player's seat to a newcomer when the room is full", async () => {
    const { t, newGuest, beOnline, view } = setup();
    const host = await newGuest('H');
    const code = await t.mutation(api.rooms.create, { token: host });
    await beOnline(host, code);
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const token = await newGuest(`P${i}`);
      await t.mutation(api.rooms.join, { token, code });
      if (i !== 3) await beOnline(token, code);
    }
    await t.mutation(api.rooms.join, { token: await newGuest('Late'), code });
    const names = (await view(host, code)).members.map((m) => m.name);
    expect(names).toHaveLength(MAX_PLAYERS);
    expect(names).toContain('Late');
    expect(names).not.toContain('P3');
  });

  it('refuses a full room but lets a member rejoin it', async () => {
    const { t, newGuest, beOnline } = setup();
    const host = await newGuest('H');
    const code = await t.mutation(api.rooms.create, { token: host });
    await beOnline(host, code);
    for (let i = 1; i < MAX_PLAYERS; i++) {
      const token = await newGuest(`P${i}`);
      await t.mutation(api.rooms.join, { token, code });
      await beOnline(token, code);
    }
    expect(await errorCode(t.mutation(api.rooms.join, { token: await newGuest('Late'), code }))).toBe('ROOM_FULL');
    expect(await t.mutation(api.rooms.join, { token: host, code })).toBe(code);
  });

  it('refuses newcomers once the match started, but lets a player back in', async () => {
    const { t, newGuest, twoPlayerRoom } = setup();
    const { host, other, code } = await twoPlayerRoom();
    await t.mutation(api.rooms.setTeam, { token: other, code, team: 'cat' });
    await t.mutation(api.rooms.setReady, { token: other, code, ready: true });
    await t.mutation(api.rooms.start, { token: host, code });
    expect(await errorCode(t.mutation(api.rooms.join, { token: await newGuest('Late'), code }))).toBe(
      'ROOM_IN_PROGRESS',
    );
    expect(await t.mutation(api.rooms.join, { token: other, code })).toBe(code);
  });
});

describe('lobby', () => {
  it('clears ready when switching team', async () => {
    const { t, view, twoPlayerRoom } = setup();
    const { other, code } = await twoPlayerRoom();
    await t.mutation(api.rooms.setReady, { token: other, code, ready: true });
    await t.mutation(api.rooms.setTeam, { token: other, code, team: 'dog' });
    const me = (await view(other, code)).members.find((m) => m.isMe)!;
    expect(me).toMatchObject({ team: 'dog', ready: false });
  });

  it('marks who is online', async () => {
    const { t, newGuest, beOnline, view } = setup();
    const host = await newGuest('H');
    const code = await t.mutation(api.rooms.create, { token: host });
    expect((await view(host, code)).members[0].online).toBe(false);
    await beOnline(host, code);
    expect((await view(host, code)).members[0].online).toBe(true);
  });

  it('passes host to the next joiner on leave, and removes an empty room', async () => {
    const { t, view, twoPlayerRoom } = setup();
    const { host, other, code } = await twoPlayerRoom();
    expect((await view(other, code)).members.find((m) => m.isHost)!.isMe).toBe(false);
    await t.mutation(api.rooms.leave, { token: host, code });
    expect((await view(other, code)).members.find((m) => m.isHost)!.isMe).toBe(true);
    await t.mutation(api.rooms.leave, { token: other, code });
    expect(await t.query(api.rooms.view, { token: other, code })).toBeNull();
  });

  it('passes host on when the host drops, and back when they return', async () => {
    const { t, view, beOnline, twoPlayerRoom } = setup();
    const { host, other, code } = await twoPlayerRoom();
    const sessionToken = await beOnline(host, code);
    await t.mutation(api.presence.disconnect, { sessionToken });
    expect((await view(other, code)).members.find((m) => m.isHost)!.isMe).toBe(true);
    await beOnline(host, code);
    expect((await view(host, code)).members.find((m) => m.isHost)!.isMe).toBe(true);
  });
});

describe('starting', () => {
  const ready = async (ctx: ReturnType<typeof setup>, token: string, code: string, team: 'dog' | 'cat') => {
    await ctx.t.mutation(api.rooms.setTeam, { token, code, team });
    await ctx.t.mutation(api.rooms.setReady, { token, code, ready: true });
  };

  it('only lets the host start', async () => {
    const ctx = setup();
    const { other, code } = await ctx.twoPlayerRoom();
    await ready(ctx, other, code, 'cat');
    expect(await errorCode(ctx.t.mutation(api.rooms.start, { token: other, code }))).toBe('NOT_THE_HOST');
  });

  it('needs someone on each team', async () => {
    const ctx = setup();
    const { host, other, code } = await ctx.twoPlayerRoom();
    await ready(ctx, other, code, 'dog');
    expect((await ctx.view(host, code)).startProblem).toBe('TEAM_EMPTY');
    expect(await errorCode(ctx.t.mutation(api.rooms.start, { token: host, code }))).toBe('TEAM_EMPTY');
  });

  it('needs everyone but the host to be ready', async () => {
    const ctx = setup();
    const { host, other, code } = await ctx.twoPlayerRoom();
    await ctx.t.mutation(api.rooms.setTeam, { token: other, code, team: 'cat' });
    expect(await errorCode(ctx.t.mutation(api.rooms.start, { token: host, code }))).toBe('NOT_EVERYONE_READY');
    await ctx.t.mutation(api.rooms.setReady, { token: other, code, ready: true });
    await ctx.t.mutation(api.rooms.start, { token: host, code });
    expect((await ctx.view(host, code)).status).toBe('playing');
  });

  it('is not blocked by an offline player, who is removed when it starts', async () => {
    const ctx = setup();
    const { host, other, code } = await ctx.twoPlayerRoom();
    await ready(ctx, other, code, 'cat');
    await ctx.t.mutation(api.rooms.join, { token: await ctx.newGuest('Ghost'), code });
    expect((await ctx.view(host, code)).members).toHaveLength(3);
    await ctx.t.mutation(api.rooms.start, { token: host, code });
    expect((await ctx.view(host, code)).members.map((m) => m.name).sort()).toEqual(['Host', 'Other']);
  });

  it('does not let an offline player count as a team', async () => {
    const ctx = setup();
    const { host, other, code } = await ctx.twoPlayerRoom();
    await ctx.t.mutation(api.rooms.setTeam, { token: other, code, team: 'dog' });
    const ghost = await ctx.newGuest('Ghost');
    await ctx.t.mutation(api.rooms.join, { token: ghost, code });
    await ctx.t.mutation(api.rooms.setTeam, { token: ghost, code, team: 'cat' });
    expect(await errorCode(ctx.t.mutation(api.rooms.start, { token: host, code }))).toBe('TEAM_EMPTY');
  });

  it('cannot start twice, or change team afterwards', async () => {
    const ctx = setup();
    const { host, other, code } = await ctx.twoPlayerRoom();
    await ready(ctx, other, code, 'cat');
    await ctx.t.mutation(api.rooms.start, { token: host, code });
    expect(await errorCode(ctx.t.mutation(api.rooms.start, { token: host, code }))).toBe('ROOM_IN_PROGRESS');
    expect(await errorCode(ctx.t.mutation(api.rooms.setTeam, { token: other, code, team: 'dog' }))).toBe(
      'ROOM_IN_PROGRESS',
    );
    expect(await errorCode(ctx.t.mutation(api.rooms.setReady, { token: other, code, ready: false }))).toBe(
      'ROOM_IN_PROGRESS',
    );
  });
});

describe('cleaning up idle rooms', () => {
  it('deletes an idle empty room and its members, keeping recent or occupied ones', async () => {
    const { t, newGuest, beOnline } = setup();
    const idle = await newGuest('Idle');
    const idleCode = await t.mutation(api.rooms.create, { token: idle });
    const occupied = await newGuest('Here');
    const occupiedCode = await t.mutation(api.rooms.create, { token: occupied });
    vi.advanceTimersByTime(ROOM_IDLE_MS + 1000);
    await beOnline(occupied, occupiedCode);
    const recent = await newGuest('Recent');
    const recentCode = await t.mutation(api.rooms.create, { token: recent });

    await t.mutation(internal.rooms.cleanupIdle, {});

    expect(await t.query(api.rooms.view, { token: idle, code: idleCode })).toBeNull();
    expect(await t.query(api.rooms.view, { token: occupied, code: occupiedCode })).not.toBeNull();
    expect(await t.query(api.rooms.view, { token: recent, code: recentCode })).not.toBeNull();
    const memberCount = await t.run(async (ctx) => (await ctx.db.query('roomMembers').collect()).length);
    expect(memberCount).toBe(2);
  });
});

import { Presence } from '@convex-dev/presence';
import { v } from 'convex/values';
import { PRESENCE_INTERVAL_MS } from '../shared/game/constants';
import { components } from './_generated/api';
import { mutation } from './_generated/server';
import { fail, requireGuest } from './guests';
import { findMember, findRoom } from './rooms';

export const presence = new Presence(components.presence);

/** Keeps the caller online in a room they belong to. The session token it returns is only good for disconnecting. */
export const heartbeat = mutation({
  args: { token: v.string(), code: v.string(), sessionId: v.string() },
  returns: v.string(),
  handler: async (ctx, { token, code, sessionId }) => {
    const guest = await requireGuest(ctx, token);
    const room = (await findRoom(ctx, code)) ?? fail('ROOM_NOT_FOUND');
    if (!(await findMember(ctx, room._id, guest._id))) fail('NOT_A_MEMBER');
    const { sessionToken } = await presence.heartbeat(ctx, room._id, guest._id, sessionId, PRESENCE_INTERVAL_MS);
    return sessionToken;
  },
});

/** Called from sendBeacon as the tab closes, so the unguessable session token is the only credential. */
export const disconnect = mutation({
  args: { sessionToken: v.string() },
  returns: v.null(),
  handler: async (ctx, { sessionToken }) => {
    await presence.disconnect(ctx, sessionToken);
    return null;
  },
});

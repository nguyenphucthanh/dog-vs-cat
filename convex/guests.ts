import { ConvexError, v } from 'convex/values';
import { MAX_NAME_LENGTH } from '../shared/game/constants';
import type { GameErrorCode } from '../shared/errors';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type QueryCtx } from './_generated/server';

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 128;

export function fail(code: GameErrorCode): never {
  throw new ConvexError(code);
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  // Spread counts characters rather than UTF-16 units, so emoji and accents are measured fairly.
  const length = [...trimmed].length;
  if (length < 1 || length > MAX_NAME_LENGTH) fail('INVALID_NAME');
  return trimmed;
}

export async function findGuest(ctx: QueryCtx, token: string): Promise<Doc<'guests'> | null> {
  if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = await hashToken(token);
  return await ctx.db
    .query('guests')
    .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
    .unique();
}

/** The only way a function learns who is calling. Identity always comes from the secret token. */
export async function requireGuest(ctx: QueryCtx, token: string): Promise<Doc<'guests'>> {
  return (await findGuest(ctx, token)) ?? fail('UNKNOWN_GUEST');
}

/**
 * Registers the token the browser generated with crypto.randomUUID(). The browser
 * generates it because Convex documents Math.random in mutations as seeded and does
 * not promise unpredictable values there. A weak token would only endanger its owner.
 */
export const create = mutation({
  args: { token: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, name }) => {
    if (token.length < MIN_TOKEN_LENGTH || token.length > MAX_TOKEN_LENGTH) fail('INVALID_TOKEN');
    const cleaned = cleanName(name);
    if (await findGuest(ctx, token)) fail('INVALID_TOKEN');
    await ctx.db.insert('guests', { tokenHash: await hashToken(token), name: cleaned });
    return null;
  },
});

export const rename = mutation({
  args: { token: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { token, name }) => {
    const guest = await requireGuest(ctx, token);
    await ctx.db.patch('guests', guest._id, { name: cleanName(name) });
    return null;
  },
});

export const me = query({
  args: { token: v.string() },
  returns: v.union(v.object({ name: v.string() }), v.null()),
  handler: async (ctx, { token }) => {
    const guest = await findGuest(ctx, token);
    return guest && { name: guest.name };
  },
});

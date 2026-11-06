'use client';

import { ConvexError } from 'convex/values';
import { useCallback, useSyncExternalStore } from 'react';
import { strings } from './strings';
import type { GameErrorCode } from '../shared/errors';

const listeners = new Set<() => void>();

/**
 * Tabs in one browser share a guest. In development, `?as=2` on a room link gives a
 * tab its own guest, so one person can play several sides while testing.
 */
function storageKey(): string {
  const slot = process.env.NODE_ENV === 'production' ? null : new URLSearchParams(window.location.search).get('as');
  return slot ? `dog-vs-cat.token.${slot}` : 'dog-vs-cat.token';
}

function readToken(): string | null {
  try {
    return window.localStorage.getItem(storageKey());
  } catch {
    return memoryToken; // Storage can be blocked, for example in some private windows.
  }
}

let memoryToken: string | null = null;

function writeToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(storageKey(), token);
    else window.localStorage.removeItem(storageKey());
  } catch {
    // memoryToken keeps this tab working until it closes.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `undefined` until the browser has been read, then the guest's secret token or null. */
export function useGuestToken() {
  const token = useSyncExternalStore<string | null | undefined>(subscribe, readToken, () => undefined);
  const clear = useCallback(() => writeToken(null), []);
  return { token, setToken: writeToken, clear };
}

export function newToken(): string {
  return crypto.randomUUID();
}

export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string' && error.data in strings.errors) {
    return strings.errors[error.data as GameErrorCode];
  }
  return strings.unknownError;
}

'use client';

import { useConvexConnectionState } from 'convex/react';
import { useEffect, useState } from 'react';
import { strings } from '../lib/strings';

const SHOW_AFTER_MS = 2000; // A blip that fixes itself isn't worth interrupting anyone for.

/** Convex reconnects and resends by itself, so all that's left to do is say what is going on. */
export function ConnectionBanner() {
  const { isWebSocketConnected } = useConvexConnectionState();
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);

  useEffect(() => {
    if (isWebSocketConnected) return;
    const timer = setTimeout(() => setWaitedLongEnough(true), SHOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
      setWaitedLongEnough(false);
    };
  }, [isWebSocketConnected]);

  if (isWebSocketConnected || !waitedLongEnough) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed left-1/2 top-24 z-50 -translate-x-1/2 whitespace-nowrap border-2 border-black/60 bg-red-700 px-4 py-2 font-mono text-sm font-bold text-white"
    >
      {strings.reconnecting}
    </div>
  );
}

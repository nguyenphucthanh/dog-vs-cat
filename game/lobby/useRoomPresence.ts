'use client';

import { useConvex, useMutation } from 'convex/react';
import { useEffect } from 'react';
import { api } from '../../convex/_generated/api';
import { PRESENCE_INTERVAL_MS } from '../../shared/game/constants';

/**
 * Keeps this tab online in a room. Written by hand because the component's own
 * usePresence hook cannot pass the guest token and goes offline whenever the tab is
 * hidden, which would drop anyone who switches away to share the room link.
 */
export function useRoomPresence(token: string | null, code: string) {
  const convex = useConvex();
  const heartbeat = useMutation(api.presence.heartbeat);

  useEffect(() => {
    if (!token) return;
    const sessionId = crypto.randomUUID();
    let sessionToken: string | null = null;
    let stopped = false;

    const beat = () => {
      heartbeat({ token, code, sessionId })
        .then((result) => {
          sessionToken = result;
          if (stopped) void convex.mutation(api.presence.disconnect, { sessionToken: result });
        })
        .catch(() => {}); // Temporary trouble: the next beat tries again.
    };
    beat();
    const timer = setInterval(beat, PRESENCE_INTERVAL_MS);

    // A closing tab can't await a mutation, and only a beacon reliably gets out.
    const onPageHide = () => {
      if (!sessionToken) return;
      const body = JSON.stringify({ path: 'presence:disconnect', args: { sessionToken } });
      navigator.sendBeacon(`${convex.url}/api/mutation`, new Blob([body], { type: 'application/json' }));
    };
    window.addEventListener('pagehide', onPageHide);

    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      if (sessionToken) void convex.mutation(api.presence.disconnect, { sessionToken });
    };
  }, [convex, heartbeat, token, code]);
}

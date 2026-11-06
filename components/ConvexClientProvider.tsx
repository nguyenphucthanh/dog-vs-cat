'use client';

import { ReactNode, useState } from 'react';
import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { ConnectionBanner } from './ConnectionBanner';

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [convex] = useState(() => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));
  return (
    <ConvexProvider client={convex}>
      {children}
      <ConnectionBanner />
    </ConvexProvider>
  );
}

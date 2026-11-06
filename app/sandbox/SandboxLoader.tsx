'use client';

import dynamic from 'next/dynamic';

// WebGL and pointer lock only exist in the browser.
const SandboxGame = dynamic(() => import('@/game/SandboxGame'), { ssr: false });

export function SandboxLoader() {
  return <SandboxGame />;
}

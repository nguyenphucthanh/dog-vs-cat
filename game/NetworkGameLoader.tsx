'use client';

import dynamic from 'next/dynamic';

// WebGL and pointer lock only exist in the browser.
export const NetworkGame = dynamic(() => import('./NetworkGame'), { ssr: false });

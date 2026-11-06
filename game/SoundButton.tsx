'use client';

import { strings } from '../lib/strings';
import { useSoundControls } from './sound';

export function SoundButton({ className }: { className: string }) {
  const { muted, toggleMuted } = useSoundControls();
  return (
    <button
      type="button"
      aria-pressed={!muted}
      tabIndex={-1} // Space is the fire key, and must never end up pressing this. The M key does the same job.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation(); // Otherwise the click would also capture the mouse.
        toggleMuted();
      }}
      className={className}
    >
      {muted ? strings.soundOff : strings.soundOn}
    </button>
  );
}

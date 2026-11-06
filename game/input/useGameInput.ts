import { useEffect, useRef, useState, type RefObject } from 'react';
import { createDesktopInput, type InputSource } from './input';
import { createTouchInput, type TouchInput } from './touchInput';

/** Fullscreen and locking to landscape give a phone its whole screen. Neither exists on every browser, notably iPhones. */
function claimScreen(): void {
  void Promise.resolve(document.documentElement.requestFullscreen?.())
    .then(() => (screen.orientation as ScreenOrientation & { lock?(kind: string): Promise<void> }).lock?.('landscape'))
    .catch(() => {});
}

/** Picks controls for whatever this device mainly points with. `touch` is null with a mouse. */
export function useGameInput(containerRef: RefObject<HTMLDivElement | null>) {
  const [touch] = useState<TouchInput | null>(() =>
    window.matchMedia('(pointer: coarse)').matches ? createTouchInput() : null,
  );
  const [locked, setLocked] = useState(false);
  const inputRef = useRef<InputSource | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    if (touch) {
      inputRef.current = touch;
      container.addEventListener('pointerup', claimScreen, { once: true });
      return () => {
        container.removeEventListener('pointerup', claimScreen);
        inputRef.current = null;
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      };
    }
    const input = createDesktopInput(container, setLocked);
    inputRef.current = input;
    return () => {
      input.dispose();
      inputRef.current = null;
    };
  }, [containerRef, touch]);

  return { inputRef, touch, locked };
}

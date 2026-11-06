'use client';

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { strings } from '../../lib/strings';
import { JOYSTICK_RADIUS, type TouchInput } from './touchInput';

const BASE_SIZE = JOYSTICK_RADIUS * 2;

/** Walks with the thumb's offset from wherever it first came down, so the stick is always under the thumb. */
function Joystick({ input }: { input: TouchInput }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: number; x: number; y: number } | null>(null);

  const showKnob = (dx: number, dy: number) => {
    const scale = Math.min(1, JOYSTICK_RADIUS / (Math.hypot(dx, dy) || 1));
    knobRef.current!.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  };
  const end = (event: PointerEvent) => {
    if (press.current?.id !== event.pointerId) return;
    press.current = null;
    input.setJoystick(0, 0);
    showKnob(0, 0);
    baseRef.current!.style.left = '';
    baseRef.current!.style.top = '';
  };

  return (
    <div
      className="pointer-events-auto absolute inset-y-0 left-0 w-2/5 touch-none"
      onPointerDown={(event) => {
        if (press.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        press.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        const box = event.currentTarget.getBoundingClientRect();
        baseRef.current!.style.left = `${event.clientX - box.left - JOYSTICK_RADIUS}px`;
        baseRef.current!.style.top = `${event.clientY - box.top - JOYSTICK_RADIUS}px`;
      }}
      onPointerMove={(event) => {
        const start = press.current;
        if (start?.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        input.setJoystick(dx, dy);
        showKnob(dx, dy);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <div
        ref={baseRef}
        className="absolute bottom-8 left-6 rounded-full border-2 border-white/50 bg-black/25"
        style={{ width: BASE_SIZE, height: BASE_SIZE }}
      >
        <div ref={knobRef} className="absolute inset-[28%] rounded-full bg-white/60" />
      </div>
    </div>
  );
}

/** Swiping turns the camera, with each finger tracked on its own so it can go on while another fires or walks. */
function LookArea({ input }: { input: TouchInput }) {
  const fingers = useRef(new Map<number, { x: number; y: number }>());
  const end = (event: PointerEvent) => fingers.current.delete(event.pointerId);
  return (
    <div
      className="pointer-events-auto absolute inset-y-0 right-0 w-3/5 touch-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }}
      onPointerMove={(event) => {
        const last = fingers.current.get(event.pointerId);
        if (!last) return;
        input.look(event.clientX - last.x, event.clientY - last.y);
        last.x = event.clientX;
        last.y = event.clientY;
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    />
  );
}

function HoldButton({
  label,
  className,
  onChange,
  children,
}: {
  label: string;
  className: string;
  onChange: (down: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      className={`pointer-events-auto absolute touch-none rounded-full border-2 border-black/50 font-bold active:brightness-125 ${className}`}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onLostPointerCapture={() => onChange(false)}
    >
      {children}
    </button>
  );
}

/** Only shown while this screen controls the active player. */
export function TouchControls({ input, enabled, canFire }: { input: TouchInput; enabled: boolean; canFire: boolean }) {
  useEffect(() => {
    if (!enabled) input.release();
  }, [input, enabled]);

  return (
    <>
      {enabled && (
        <>
          <Joystick input={input} />
          <LookArea input={input} />
          <HoldButton
            label={strings.fire}
            onChange={input.setFire}
            className={`right-3 top-3 h-20 w-20 bg-red-600/80 text-sm ${canFire ? '' : 'opacity-30'}`}
          >
            {strings.fire}
          </HoldButton>
          <HoldButton
            label={strings.jump}
            onChange={input.setJump}
            className="bottom-28 right-5 h-16 w-16 bg-sky-600/80 text-xs"
          >
            {strings.jump}
          </HoldButton>
        </>
      )}
      <div className="pointer-events-auto fixed inset-0 z-50 hidden items-center justify-center bg-black/90 p-8 text-center text-xl portrait:flex">
        {strings.rotatePhone}
      </div>
    </>
  );
}

import type { FrameInput, InputSource } from './input';

export const JOYSTICK_RADIUS = 56; // Pixels of thumb travel for a full-speed walk.
const JOYSTICK_DEAD_ZONE = 0.15; // Keeps a resting thumb from creeping the player along.
const LOOK_SENSITIVITY = 0.005; // Radians per pixel. A swipe covers less ground than a mouse does.

/** Thumb offset from the joystick's centre in screen pixels, as walking speed from 0 to 1 in each direction. */
export function joystickToMove(dx: number, dy: number): { moveForward: number; moveRight: number } {
  const distance = Math.hypot(dx, dy);
  const strength = Math.min(1, distance / JOYSTICK_RADIUS);
  if (strength < JOYSTICK_DEAD_ZONE) return { moveForward: 0, moveRight: 0 };
  // Speed starts from nothing just past the dead zone instead of jumping up to it.
  const speed = (strength - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
  return { moveForward: (-dy / distance) * speed, moveRight: (dx / distance) * speed };
}

export type TouchInput = InputSource & {
  setJoystick(dx: number, dy: number): void;
  setFire(down: boolean): void;
  setJump(down: boolean): void;
  look(dx: number, dy: number): void;
  /** Lets go of everything, for when the controls disappear while a finger is still down. */
  release(): void;
};

/** The on-screen controls write here and the game reads the same `FrameInput` a keyboard and mouse produce. */
export function createTouchInput(): TouchInput {
  let move = { moveForward: 0, moveRight: 0 };
  let fire = false;
  let jump = false;
  let yawDelta = 0;
  let pitchDelta = 0;

  return {
    setJoystick: (dx, dy) => {
      move = joystickToMove(dx, dy);
    },
    setFire: (down) => {
      fire = down;
    },
    setJump: (down) => {
      jump = down;
    },
    look: (dx, dy) => {
      yawDelta -= dx * LOOK_SENSITIVITY;
      pitchDelta -= dy * LOOK_SENSITIVITY;
    },
    release: () => {
      move = { moveForward: 0, moveRight: 0 };
      fire = false;
      jump = false;
    },
    read: (): FrameInput => {
      const frame = { ...move, jump, fire, yawDelta, pitchDelta };
      yawDelta = 0;
      pitchDelta = 0;
      return frame;
    },
    dispose: () => {},
  };
}

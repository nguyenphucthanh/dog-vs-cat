import { describe, expect, it } from 'vitest';
import { createTouchInput, JOYSTICK_RADIUS, joystickToMove } from './touchInput';

describe('joystickToMove', () => {
  it('walks forward when pushed up the screen, and right when pushed right', () => {
    expect(joystickToMove(0, -JOYSTICK_RADIUS).moveForward).toBeCloseTo(1);
    expect(joystickToMove(0, JOYSTICK_RADIUS).moveForward).toBeCloseTo(-1);
    expect(joystickToMove(JOYSTICK_RADIUS, 0).moveRight).toBeCloseTo(1);
    expect(joystickToMove(-JOYSTICK_RADIUS, 0).moveRight).toBeCloseTo(-1);
  });

  it('ignores a resting thumb', () => {
    expect(joystickToMove(3, 3)).toEqual({ moveForward: 0, moveRight: 0 });
    expect(joystickToMove(0, 0)).toEqual({ moveForward: 0, moveRight: 0 });
  });

  it('never exceeds full speed, even diagonally or dragged far past the edge', () => {
    const { moveForward, moveRight } = joystickToMove(500, -500);
    expect(Math.hypot(moveForward, moveRight)).toBeCloseTo(1);
  });

  it('gets faster the further it is pushed, starting from nothing', () => {
    const justPast = joystickToMove(0, -JOYSTICK_RADIUS * 0.16).moveForward;
    const halfway = joystickToMove(0, -JOYSTICK_RADIUS * 0.5).moveForward;
    expect(justPast).toBeLessThan(0.05);
    expect(halfway).toBeGreaterThan(justPast);
    expect(halfway).toBeLessThan(1);
  });
});

describe('createTouchInput', () => {
  it('reports each swipe once, turning the same way a mouse does', () => {
    const input = createTouchInput();
    input.look(10, 20);
    input.look(10, 0);
    const frame = input.read();
    expect(frame.yawDelta).toBeLessThan(0); // Swiping right looks right, as moving a mouse right does.
    expect(frame.pitchDelta).toBeLessThan(0);
    expect(input.read().yawDelta).toBe(0);
  });

  it('holds buttons down until they are let go, and lets go of everything at once', () => {
    const input = createTouchInput();
    input.setFire(true);
    input.setJump(true);
    input.setJoystick(0, -JOYSTICK_RADIUS);
    expect(input.read()).toMatchObject({ fire: true, jump: true });
    expect(input.read().fire).toBe(true);
    input.release();
    expect(input.read()).toMatchObject({ fire: false, jump: false, moveForward: 0, moveRight: 0 });
  });
});

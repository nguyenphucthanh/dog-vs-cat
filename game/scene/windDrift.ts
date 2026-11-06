import { WIND_MAX } from '../../shared/game/constants';
import type { Wind } from '../../shared/game/projectile';

const CALM_BELOW = 0.05; // Hardly any wind: nothing in the air, which itself tells the player something.
const SLOWEST = 3;
const FASTEST = 18;

/** What the wind looks like on screen: which way things blow, how fast, and how much of it there is. */
export function windDrift({ x, z }: Wind) {
  const length = Math.hypot(x, z);
  const strength = Math.min(1, length / WIND_MAX);
  if (strength < CALM_BELOW) return { directionX: 0, directionZ: 0, speed: 0, amount: 0 };
  return {
    directionX: x / length,
    directionZ: z / length,
    speed: SLOWEST + (FASTEST - SLOWEST) * strength,
    amount: 0.25 + 0.75 * strength,
  };
}

/** Brings a value back into the `size`-wide range around `center`, so drifting things reappear on the far side. */
export function wrapAround(value: number, center: number, size: number): number {
  const offset = (value - center + size / 2) % size;
  return center - size / 2 + (offset < 0 ? offset + size : offset);
}

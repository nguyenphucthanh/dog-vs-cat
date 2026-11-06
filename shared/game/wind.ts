import { WIND_MAX, WIND_MAX_CHANGE } from './constants';
import { createRng, mixSeed } from './rng';
import type { Wind } from './projectile';

const WIND_STREAM = 5;

function randomOffset(rng: () => number, reach: number): Wind {
  // Rejection sampling keeps the direction uniform.
  for (;;) {
    const x = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    if (x * x + z * z <= 1) return { x: x * reach, z: z * reach };
  }
}

function clampStrength({ x, z }: Wind): Wind {
  const strength = Math.hypot(x, z);
  if (strength <= WIND_MAX) return { x, z };
  return { x: (x / strength) * WIND_MAX, z: (z / strength) * WIND_MAX };
}

export function initialWind(seed: number): Wind {
  return randomOffset(createRng(mixSeed(seed, WIND_STREAM, 0)), WIND_MAX);
}

/** The wind for `turnNumber`: drifts from the previous turn's wind, never jumps. */
export function nextWind(seed: number, turnNumber: number, previous: Wind): Wind {
  const offset = randomOffset(createRng(mixSeed(seed, WIND_STREAM, turnNumber)), WIND_MAX_CHANGE);
  return clampStrength({ x: previous.x + offset.x, z: previous.z + offset.z });
}

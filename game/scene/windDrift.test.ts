import { describe, expect, it } from 'vitest';
import { WIND_MAX } from '../../shared/game/constants';
import { windDrift, wrapAround } from './windDrift';

describe('windDrift', () => {
  it('blows the way the wind pushes shots', () => {
    const drift = windDrift({ x: -3, z: 4 });
    expect(drift.directionX).toBeCloseTo(-0.6);
    expect(drift.directionZ).toBeCloseTo(0.8);
  });

  it('gets faster and busier with strength', () => {
    const weak = windDrift({ x: WIND_MAX / 4, z: 0 });
    const strong = windDrift({ x: WIND_MAX, z: 0 });
    expect(strong.speed).toBeGreaterThan(weak.speed);
    expect(strong.amount).toBe(1);
    expect(weak.amount).toBeLessThan(1);
  });

  it('shows nothing when calm', () => {
    expect(windDrift({ x: 0, z: 0 }).amount).toBe(0);
    expect(windDrift({ x: 0.01, z: 0 }).amount).toBe(0);
  });
});

describe('wrapAround', () => {
  it('leaves a value inside the range alone, and brings others back to the far side', () => {
    expect(wrapAround(12, 10, 20)).toBe(12);
    expect(wrapAround(21, 10, 20)).toBe(1);
    expect(wrapAround(-1, 10, 20)).toBe(19);
    expect(wrapAround(-55, 10, 20)).toBe(5);
    expect(wrapAround(1000.5, 10, 20)).toBe(0.5);
  });
});

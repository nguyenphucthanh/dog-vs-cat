import { describe, expect, it } from 'vitest';
import { MAP_SIZE } from '../../shared/game/constants';
import { carveSphere, generateTerrain, topSolidY } from '../../shared/game/terrain';
import { minimapPixels } from './minimapPixels';

const pixelAt = (pixels: Uint8ClampedArray, x: number, z: number) =>
  Array.from(pixels.slice((x + z * MAP_SIZE) * 4, (x + z * MAP_SIZE) * 4 + 4));
const WATER = [47, 134, 201, 255];

describe('minimapPixels', () => {
  it('draws one opaque pixel per column, with water around the island and land in the middle', () => {
    const pixels = minimapPixels(generateTerrain(1));
    expect(pixels.length).toBe(MAP_SIZE * MAP_SIZE * 4);
    expect(pixelAt(pixels, 0, 0)).toEqual(WATER);
    expect(pixelAt(pixels, MAP_SIZE - 1, MAP_SIZE - 1)).toEqual(WATER);
    const center = pixelAt(pixels, MAP_SIZE / 2, MAP_SIZE / 2);
    expect(center).not.toEqual(WATER);
    expect(center[3]).toBe(255);
  });

  it('shows a crater', () => {
    const terrain = generateTerrain(1);
    const before = pixelAt(minimapPixels(terrain), 32, 32);
    carveSphere(terrain, { x: 32.5, y: topSolidY(terrain, 32, 32), z: 32.5, radius: 3 });
    expect(pixelAt(minimapPixels(terrain), 32, 32)).not.toEqual(before);
  });
});

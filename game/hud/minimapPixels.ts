import { MAP_HEIGHT, MAP_SIZE, WATER_SURFACE } from '../../shared/game/constants';
import { getBlock, topSolidY, type BlockId, type Terrain } from '../../shared/game/terrain';
import { BLOCK_COLORS } from '../scene/chunkGeometry';

const WATER: [number, number, number] = [47, 134, 201];

/** One RGBA pixel per map column, seen from above. Higher ground is drawn brighter. */
export function minimapPixels(terrain: Terrain): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(MAP_SIZE * MAP_SIZE * 4);
  for (let z = 0; z < MAP_SIZE; z++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const y = topSolidY(terrain, x, z);
      const isWater = y + 1 <= WATER_SURFACE;
      let color = WATER;
      if (!isWater) {
        const [r, g, b] = BLOCK_COLORS[getBlock(terrain, x, y, z) as BlockId];
        const light = 0.65 + (0.6 * y) / MAP_HEIGHT;
        color = [r * 255 * light, g * 255 * light, b * 255 * light];
      }
      const i = (x + z * MAP_SIZE) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

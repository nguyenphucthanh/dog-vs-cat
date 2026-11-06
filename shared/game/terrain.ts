import { BEDROCK_LAYERS, MAP_HEIGHT, MAP_SIZE, SPAWN_MIN_DISTANCE, WATER_LEVEL } from './constants';
import { createRng, mixSeed, type Rng } from './rng';

export const Block = {
  Air: 0,
  Bedrock: 1,
  Stone: 2,
  Dirt: 3,
  Grass: 4,
  Wood: 5,
  Leaves: 6,
  Brick: 7,
} as const;
export type BlockId = (typeof Block)[keyof typeof Block];

export type Terrain = { blocks: Uint8Array };
export type Vec3 = { x: number; y: number; z: number };
export type Crater = Vec3 & { radius: number };

export function createEmptyTerrain(): Terrain {
  return { blocks: new Uint8Array(MAP_SIZE * MAP_SIZE * MAP_HEIGHT) };
}

function index(x: number, y: number, z: number): number {
  return x + z * MAP_SIZE + y * MAP_SIZE * MAP_SIZE;
}

function inBounds(x: number, y: number, z: number): boolean {
  return x >= 0 && x < MAP_SIZE && z >= 0 && z < MAP_SIZE && y >= 0 && y < MAP_HEIGHT;
}

/** Everything outside the map reads as air. */
export function getBlock(terrain: Terrain, x: number, y: number, z: number): BlockId {
  return inBounds(x, y, z) ? (terrain.blocks[index(x, y, z)] as BlockId) : Block.Air;
}

export function setBlock(terrain: Terrain, x: number, y: number, z: number, block: BlockId): void {
  if (inBounds(x, y, z)) terrain.blocks[index(x, y, z)] = block;
}

export function isSolid(terrain: Terrain, x: number, y: number, z: number): boolean {
  return getBlock(terrain, x, y, z) !== Block.Air;
}

/** Y of the highest solid block in a column, or -1 if the column is empty. */
export function topSolidY(terrain: Terrain, x: number, z: number): number {
  for (let y = MAP_HEIGHT - 1; y >= 0; y--) {
    if (isSolid(terrain, x, y, z)) return y;
  }
  return -1;
}

/** Removes every block whose centre is inside the sphere. Bedrock survives. */
export function carveSphere(terrain: Terrain, { x, y, z, radius }: Crater): void {
  const r2 = radius * radius;
  const minY = Math.max(BEDROCK_LAYERS, Math.floor(y - radius));
  const maxY = Math.min(MAP_HEIGHT - 1, Math.floor(y + radius));
  const minZ = Math.max(0, Math.floor(z - radius));
  const maxZ = Math.min(MAP_SIZE - 1, Math.floor(z + radius));
  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(MAP_SIZE - 1, Math.floor(x + radius));
  for (let by = minY; by <= maxY; by++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      for (let bx = minX; bx <= maxX; bx++) {
        const dx = bx + 0.5 - x;
        const dy = by + 0.5 - y;
        const dz = bz + 0.5 - z;
        if (dx * dx + dy * dy + dz * dz <= r2) terrain.blocks[index(bx, by, bz)] = Block.Air;
      }
    }
  }
}

/**
 * Builds the island for a seed.
 *
 * Client and server must produce identical voxels independently, so this path
 * uses only the seeded RNG and + - * / floor. No Math.random, Date.now, Math.sin
 * or Math.pow, whose results are not guaranteed to match across engines.
 */
export function generateTerrain(seed: number): Terrain {
  const terrain = createEmptyTerrain();
  const heights = generateHeights(seed);
  for (let z = 0; z < MAP_SIZE; z++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const height = heights[x + z * MAP_SIZE];
      for (let y = 0; y <= height; y++) {
        let block: BlockId = Block.Stone;
        if (y < BEDROCK_LAYERS) block = Block.Bedrock;
        else if (y === height) block = height > WATER_LEVEL ? Block.Grass : Block.Dirt;
        else if (y > height - 4) block = Block.Dirt;
        terrain.blocks[index(x, y, z)] = block;
      }
    }
  }
  const rng = createRng(mixSeed(seed, 2));
  for (let i = 0; i < 3; i++) placeHouse(terrain, rng);
  for (let i = 0; i < 14; i++) placeTree(terrain, rng);
  return terrain;
}

/** The terrain for a match: its seed plus every explosion so far, in order. */
export function buildTerrain(seed: number, craters: readonly Crater[]): Terrain {
  const terrain = generateTerrain(seed);
  for (const crater of craters) carveSphere(terrain, crater);
  return terrain;
}

function generateHeights(seed: number): Int32Array {
  const heights = new Int32Array(MAP_SIZE * MAP_SIZE);
  const coarse = latticeNoise(seed, 1, 16);
  const fine = latticeNoise(seed, 2, 6);
  const center = MAP_SIZE / 2;
  for (let z = 0; z < MAP_SIZE; z++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const dx = (x + 0.5 - center) / center;
      const dz = (z + 0.5 - center) / center;
      const island = Math.max(0, 1 - (dx * dx + dz * dz)); // 1 at the centre, 0 at the shore line.
      const noise = coarse(x, z) * 0.75 + fine(x, z) * 0.25;
      heights[x + z * MAP_SIZE] = Math.floor(WATER_LEVEL - 2 + island * (4 + noise * 13));
    }
  }
  return heights;
}

/** Smooth value noise in [0, 1] over a random grid with the given cell size. */
function latticeNoise(seed: number, stream: number, cell: number) {
  const rng = createRng(mixSeed(seed, stream));
  const side = Math.floor(MAP_SIZE / cell) + 2;
  const grid = new Float64Array(side * side);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, z: number) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const tx = smooth(x / cell - cx);
    const tz = smooth(z / cell - cz);
    const at = (gx: number, gz: number) => grid[gx + gz * side];
    const top = at(cx, cz) + (at(cx + 1, cz) - at(cx, cz)) * tx;
    const bottom = at(cx, cz + 1) + (at(cx + 1, cz + 1) - at(cx, cz + 1)) * tx;
    return top + (bottom - top) * tz;
  };
}

function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function placeTree(terrain: Terrain, rng: Rng): void {
  const x = randomInt(rng, 2, MAP_SIZE - 3);
  const z = randomInt(rng, 2, MAP_SIZE - 3);
  const base = topSolidY(terrain, x, z);
  if (base <= WATER_LEVEL + 1 || getBlock(terrain, x, base, z) !== Block.Grass) return;
  const trunk = randomInt(rng, 3, 4);
  if (base + trunk + 2 >= MAP_HEIGHT) return;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        setBlock(terrain, x + dx, base + trunk + dy, z + dz, Block.Leaves);
      }
    }
  }
  setBlock(terrain, x, base + trunk + 2, z, Block.Leaves);
  for (let y = 1; y <= trunk; y++) setBlock(terrain, x, base + y, z, Block.Wood);
}

function placeHouse(terrain: Terrain, rng: Rng): void {
  const size = 5;
  const wallHeight = 3;
  const x0 = randomInt(rng, 8, MAP_SIZE - 8 - size);
  const z0 = randomInt(rng, 8, MAP_SIZE - 8 - size);
  const base = topSolidY(terrain, x0 + 2, z0 + 2);
  if (base <= WATER_LEVEL + 1 || base + wallHeight + 2 >= MAP_HEIGHT) return;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || x === size - 1 || z === 0 || z === size - 1;
      const door = z === 0 && x === 2;
      // Fill below the floor so the house never hangs off a slope.
      for (let y = base - 3; y <= base; y++) setBlock(terrain, x0 + x, y, z0 + z, Block.Stone);
      for (let y = 1; y <= wallHeight; y++) {
        const isDoorGap = door && y <= 2;
        const block = edge && !isDoorGap ? Block.Brick : Block.Air;
        setBlock(terrain, x0 + x, base + y, z0 + z, block);
      }
      setBlock(terrain, x0 + x, base + wallHeight + 1, z0 + z, Block.Wood);
    }
  }
}

/** Faces a spawn towards the middle of the island. */
export function spawnYaw({ x, z }: Vec3): number {
  return Math.atan2(x - MAP_SIZE / 2, z - MAP_SIZE / 2);
}

/**
 * Feet positions for both teams: dogs on the low-x half, cats on the high-x half,
 * all standing on open grass. Relaxes the spacing if the map is too cramped.
 */
export function pickSpawns(
  terrain: Terrain,
  seed: number,
  dogCount: number,
  catCount: number,
): { dog: Vec3[]; cat: Vec3[] } {
  const rng = createRng(mixSeed(seed, 3));
  const taken: Vec3[] = [];
  const half = MAP_SIZE / 2;
  const pick = (minX: number, maxX: number): Vec3 => {
    let minDistance = SPAWN_MIN_DISTANCE;
    let spot: Vec3 | null = null;
    while (!spot) {
      for (let attempt = 0; attempt < 500 && !spot; attempt++) {
        const x = randomInt(rng, minX, maxX);
        const z = randomInt(rng, 0, MAP_SIZE - 1);
        const y = topSolidY(terrain, x, z);
        if (getBlock(terrain, x, y, z) !== Block.Grass) continue;
        const candidate = { x: x + 0.5, y: y + 1, z: z + 0.5 };
        const clear = taken.every(
          ({ x: tx, z: tz }) => (tx - candidate.x) ** 2 + (tz - candidate.z) ** 2 >= minDistance ** 2,
        );
        if (clear) spot = candidate;
      }
      if (minDistance === 0 && !spot) throw new Error('Terrain has no grass to spawn on');
      minDistance = Math.max(0, minDistance - 2);
    }
    taken.push(spot);
    return spot;
  };
  const dog = Array.from({ length: dogCount }, () => pick(0, half - 1));
  const cat = Array.from({ length: catCount }, () => pick(half, MAP_SIZE - 1));
  return { dog, cat };
}

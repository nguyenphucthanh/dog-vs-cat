import { MAP_HEIGHT } from '../../shared/game/constants';
import { Block, getBlock, isSolid, type BlockId, type Terrain } from '../../shared/game/terrain';

export const CHUNK_SIZE = 16;

export type ChunkMeshData = {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
};

export const BLOCK_COLORS: Record<BlockId, [number, number, number]> = {
  [Block.Air]: [0, 0, 0],
  [Block.Bedrock]: [0.2, 0.2, 0.24],
  [Block.Stone]: [0.48, 0.48, 0.5],
  [Block.Dirt]: [0.5, 0.33, 0.2],
  [Block.Grass]: [0.36, 0.66, 0.28],
  [Block.Wood]: [0.42, 0.28, 0.15],
  [Block.Leaves]: [0.2, 0.5, 0.22],
  [Block.Brick]: [0.68, 0.32, 0.26],
};

// Each face: outward normal, a brightness that makes block edges readable, and four corners.
const FACES = [
  {
    dir: [1, 0, 0],
    shade: 0.82,
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    dir: [-1, 0, 0],
    shade: 0.82,
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, 1, 0],
    shade: 1,
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    dir: [0, -1, 0],
    shade: 0.6,
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    dir: [0, 0, 1],
    shade: 0.9,
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    dir: [0, 0, -1],
    shade: 0.9,
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
] as const;

/** Small per-block brightness change so flat ground still reads as separate cubes. */
function jitter(x: number, y: number, z: number): number {
  let h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  h ^= h >>> 13;
  return 0.94 + ((h >>> 0) % 13) / 100;
}

/** Builds only the faces of a chunk that touch air. */
export function buildChunkMesh(terrain: Terrain, cx: number, cz: number): ChunkMeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let z = minZ; z < minZ + CHUNK_SIZE; z++) {
      for (let x = minX; x < minX + CHUNK_SIZE; x++) {
        const block = getBlock(terrain, x, y, z);
        if (block === Block.Air) continue;
        const [r, g, b] = BLOCK_COLORS[block];
        const brightness = jitter(x, y, z);
        for (const face of FACES) {
          if (isSolid(terrain, x + face.dir[0], y + face.dir[1], z + face.dir[2])) continue;
          const first = positions.length / 3;
          const light = face.shade * brightness;
          for (const corner of face.corners) {
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            colors.push(r * light, g * light, b * light);
          }
          indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };
}

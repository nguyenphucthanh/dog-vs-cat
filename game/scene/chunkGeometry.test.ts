import { describe, expect, it } from 'vitest';
import { Block, carveSphere, createEmptyTerrain, generateTerrain, setBlock } from '../../shared/game/terrain';
import { buildChunkMesh, CHUNK_SIZE } from './chunkGeometry';

const facesOf = (mesh: ReturnType<typeof buildChunkMesh>) => mesh.indices.length / 6;

describe('buildChunkMesh', () => {
  it('draws all six faces of a lone block', () => {
    const terrain = createEmptyTerrain();
    setBlock(terrain, 3, 5, 3, Block.Stone);
    const mesh = buildChunkMesh(terrain, 0, 0);
    expect(facesOf(mesh)).toBe(6);
    expect(mesh.positions.length).toBe(6 * 4 * 3);
  });

  it('hides the faces two blocks share', () => {
    const terrain = createEmptyTerrain();
    setBlock(terrain, 3, 5, 3, Block.Stone);
    setBlock(terrain, 4, 5, 3, Block.Stone);
    expect(facesOf(buildChunkMesh(terrain, 0, 0))).toBe(10);
  });

  it('hides faces against a block in the next chunk', () => {
    const terrain = createEmptyTerrain();
    setBlock(terrain, CHUNK_SIZE - 1, 5, 3, Block.Stone);
    setBlock(terrain, CHUNK_SIZE, 5, 3, Block.Stone);
    expect(facesOf(buildChunkMesh(terrain, 0, 0))).toBe(5);
    expect(facesOf(buildChunkMesh(terrain, 1, 0))).toBe(5);
  });

  it('winds faces so they point outward', () => {
    const terrain = createEmptyTerrain();
    setBlock(terrain, 3, 5, 3, Block.Stone);
    const { positions: p, normals: n, indices: idx } = buildChunkMesh(terrain, 0, 0);
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3];
      const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
      const v = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      expect(cross[0] * n[a] + cross[1] * n[a + 1] + cross[2] * n[a + 2]).toBeGreaterThan(0);
    }
  });

  it('rebuilds the worst-case chunks of a crater quickly enough for one frame', () => {
    const terrain = generateTerrain(7);
    carveSphere(terrain, { x: 32, y: 10, z: 32, radius: 3 });
    const chunks = [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ];
    const samples = Array.from({ length: 5 }, () => {
      const start = performance.now();
      for (const [cx, cz] of chunks) buildChunkMesh(terrain, cx, cz);
      return performance.now() - start;
    });
    const elapsed = Math.min(...samples);
    console.log(`4 chunk rebuild: ${samples.map((s) => s.toFixed(1)).join(', ')} ms`);
    expect(elapsed).toBeLessThan(16);
  });
});

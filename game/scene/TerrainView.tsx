'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshLambertMaterial } from 'three';
import { MAP_SIZE } from '../../shared/game/constants';
import type { MatchView } from '../match/matchView';
import { buildChunkMesh, CHUNK_SIZE } from './chunkGeometry';

const CHUNKS_PER_SIDE = MAP_SIZE / CHUNK_SIZE;

function toGeometry(match: MatchView, cx: number, cz: number): BufferGeometry {
  const data = buildChunkMesh(match.terrain, cx, cz);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(data.normals, 3));
  geometry.setAttribute('color', new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  return geometry;
}

/** One mesh per chunk, built imperatively so a crater only rebuilds the chunks it touched. */
export function TerrainView({ match }: { match: MatchView }) {
  const groupRef = useRef<Group>(null);
  const meshesRef = useRef<Mesh[]>([]);

  useEffect(() => {
    const group = groupRef.current!;
    const material = new MeshLambertMaterial({ vertexColors: true });
    const meshes: Mesh[] = [];
    for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
      for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
        const mesh = new Mesh(toGeometry(match, cx, cz), material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        meshes.push(mesh);
      }
    }
    meshesRef.current = meshes;
    return () => {
      for (const mesh of meshes) {
        mesh.geometry.dispose();
        group.remove(mesh);
      }
      material.dispose();
    };
  }, [match]);

  useFrame(() => {
    for (const chunk of match.drainDirtyChunks()) {
      const mesh = meshesRef.current[chunk];
      mesh.geometry.dispose();
      mesh.geometry = toGeometry(match, chunk % CHUNKS_PER_SIDE, Math.floor(chunk / CHUNKS_PER_SIDE));
    }
  });

  return <group ref={groupRef} />;
}

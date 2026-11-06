'use client';

import { useEffect, useRef } from 'react';
import { strings } from '../../lib/strings';
import { MAP_SIZE } from '../../shared/game/constants';
import type { MatchView } from '../match/matchView';
import { minimapPixels } from './minimapPixels';

const SIZE = 168;
const SCALE = SIZE / MAP_SIZE;
const DOT = 7;
const DIRECTION_LENGTH = 16;
const TEAM_COLORS = { dog: '#f59e0b', cat: '#f1f5f9' };

/** Seen from above with -Z at the top. The ground is cached and only redrawn when it changes. */
export function Minimap({ match }: { match: MatchView }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const context = canvasRef.current!.getContext('2d')!;
    const ground = document.createElement('canvas');
    ground.width = MAP_SIZE;
    ground.height = MAP_SIZE;
    const groundContext = ground.getContext('2d')!;
    let drawnVersion = -1;

    let frame = requestAnimationFrame(function paint() {
      if (drawnVersion !== match.terrainVersion) {
        drawnVersion = match.terrainVersion;
        groundContext.putImageData(new ImageData(minimapPixels(match.terrain), MAP_SIZE, MAP_SIZE), 0, 0);
      }
      context.imageSmoothingEnabled = false;
      context.drawImage(ground, 0, 0, SIZE, SIZE);

      const { active, projectile } = match;
      if (active.alive) {
        const x = active.body.x * SCALE;
        const y = active.body.z * SCALE;
        context.strokeStyle = '#fde047';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x - Math.sin(active.yaw) * DIRECTION_LENGTH, y - Math.cos(active.yaw) * DIRECTION_LENGTH);
        context.stroke();
      }
      for (const player of match.players) {
        if (!player.alive) continue;
        const x = player.body.x * SCALE - DOT / 2;
        const y = player.body.z * SCALE - DOT / 2;
        context.fillStyle = '#111';
        context.fillRect(x - 1, y - 1, DOT + 2, DOT + 2);
        context.fillStyle = TEAM_COLORS[player.team];
        context.fillRect(x, y, DOT, DOT);
      }
      if (projectile) {
        context.fillStyle = '#ef4444';
        context.fillRect(projectile.position.x * SCALE - 2, projectile.position.z * SCALE - 2, 4, 4);
      }
      frame = requestAnimationFrame(paint);
    });
    return () => cancelAnimationFrame(frame);
  }, [match]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={strings.minimap}
      className="block border-2 border-black/60 short:h-24 short:w-24"
    />
  );
}

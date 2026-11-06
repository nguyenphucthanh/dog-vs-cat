'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { CanvasTexture, Vector3, type Sprite } from 'three';
import { MAX_HP } from '../../shared/game/constants';
import type { MatchPlayer, MatchView } from '../match/matchView';

const WIDTH = 256;
const HEIGHT = 64;
const LABEL_HEIGHT_ABOVE_FEET = 2.3;
const MIN_WORLD_WIDTH = 1.5;
const WIDTH_PER_DISTANCE = 0.13; // Keeps the text about the same size on screen, whatever the distance.
const TEAM_COLORS = { dog: '#fcd34d', cat: '#e2e8f0' };

function hpColor(ratio: number): string {
  if (ratio > 0.5) return '#4ade80';
  return ratio > 0.25 ? '#facc15' : '#ef4444';
}

/** The name and health bar, drawn to a canvas that is only repainted when health changes. */
class LabelTexture {
  readonly texture: CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private drawnHp: number | null = null;

  constructor(private readonly player: MatchPlayer) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.context = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
  }

  update(): void {
    const { hp, name, team } = this.player;
    if (hp === this.drawnHp) return;
    this.drawnHp = hp;
    const { context } = this;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.font = 'bold 28px sans-serif';
    context.textAlign = 'center';
    context.lineWidth = 5;
    context.strokeStyle = '#000';
    context.fillStyle = TEAM_COLORS[team];
    context.strokeText(name, WIDTH / 2, 30, WIDTH - 8);
    context.fillText(name, WIDTH / 2, 30, WIDTH - 8);

    const ratio = hp / MAX_HP;
    context.fillStyle = '#000';
    context.fillRect(28, 40, WIDTH - 56, 18);
    context.fillStyle = '#3f3f46';
    context.fillRect(31, 43, WIDTH - 62, 12);
    context.fillStyle = hpColor(ratio);
    context.fillRect(31, 43, (WIDTH - 62) * ratio, 12);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export function PlayerLabel({ match, player }: { match: MatchView; player: MatchPlayer }) {
  const [label] = useState(() => new LabelTexture(player));
  const spriteRef = useRef<Sprite>(null);
  const [worldPosition] = useState(() => new Vector3());

  useEffect(() => () => label.dispose(), [label]);

  useFrame(({ camera }) => {
    const sprite = spriteRef.current!;
    // Whoever the camera sits behind needs no label: it would only cover the view.
    sprite.visible = !(match.activeId === player.id && match.focus === null);
    if (!sprite.visible) return;
    label.update();
    sprite.getWorldPosition(worldPosition);
    const width = Math.max(MIN_WORLD_WIDTH, camera.position.distanceTo(worldPosition) * WIDTH_PER_DISTANCE);
    sprite.scale.set(width, (width * HEIGHT) / WIDTH, 1);
  });

  return (
    <sprite ref={spriteRef} position={[0, LABEL_HEIGHT_ABOVE_FEET, 0]} renderOrder={10}>
      {/* Drawn over terrain, so a player behind a hill can still be found and aimed at. */}
      <spriteMaterial map={label.texture} depthTest={false} transparent />
    </sprite>
  );
}

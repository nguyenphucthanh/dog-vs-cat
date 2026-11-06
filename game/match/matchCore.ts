import { CRATER_RADIUS, EXPLOSION_PAUSE_MS, MAP_SIZE, SIM_DT, WATER_SURFACE } from '../../shared/game/constants';
import type { Hit } from '../../shared/game/explosion';
import { createBody, isDrowned, stepBody } from '../../shared/game/player';
import { stepProjectile, type Wind } from '../../shared/game/projectile';
import { carveSphere, type Terrain, type Vec3 } from '../../shared/game/terrain';
import type { FrameInput } from '../input/input';
import type { MatchEffect, MatchPlayer } from './matchView';

export type ReplayShot = {
  origin: Vec3;
  velocity: Vec3;
  wind: Wind;
  flightMs: number;
  impact: Vec3 | null;
  hits: Hit[];
};

type Replay = {
  shot: ReplayShot;
  position: Vec3;
  velocity: Vec3;
  elapsedMs: number;
  pauseLeftMs: number;
  exploded: boolean;
};

export const STEP_MS = SIM_DT * 1000;
const MAX_FRAME_MS = 100; // After a stall, drop the lost time instead of fast-forwarding through it.
const CHUNK_SIZE = 16;

/**
 * What every kind of match shares: the fixed-step clock, and playing back a shot whose
 * outcome is already known by revealing it over time on the visible terrain.
 */
export abstract class MatchCore {
  private accumulatorMs = 0;
  private effects: MatchEffect[] = [];
  private dirtyChunks = new Set<number>();
  private replay: Replay | null = null;

  protected constructor(
    readonly terrain: Terrain,
    readonly players: MatchPlayer[],
  ) {}

  protected abstract tick(input: FrameInput): void;
  protected abstract applyAim(input: FrameInput): void;

  get projectile() {
    const replay = this.replay;
    return replay && !replay.exploded ? { position: replay.position, velocity: replay.velocity } : null;
  }

  get focus(): Vec3 | null {
    const replay = this.replay;
    if (!replay) return null;
    return replay.exploded && replay.shot.impact ? replay.shot.impact : replay.position;
  }

  protected get isReplaying(): boolean {
    return this.replay !== null;
  }

  update(frameMs: number, input: FrameInput): void {
    this.applyAim(input);
    this.accumulatorMs += Math.min(frameMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= STEP_MS) {
      this.accumulatorMs -= STEP_MS;
      for (const player of this.players) player.walking = false;
      this.tick(input);
    }
  }

  /** Effects that started since the last call. */
  drainEffects(): MatchEffect[] {
    const effects = this.effects;
    this.effects = [];
    return effects;
  }

  /** Terrain chunks needing a new mesh since the last call, as `cx + cz * chunksPerSide`. */
  drainDirtyChunks(): number[] {
    const chunks = [...this.dirtyChunks];
    this.dirtyChunks.clear();
    return chunks;
  }

  protected player(id: string): MatchPlayer {
    return this.players.find((p) => p.id === id)!;
  }

  protected carve(center: Vec3): void {
    carveSphere(this.terrain, { ...center, radius: CRATER_RADIUS });
    // One block of padding: faces of a neighbouring chunk can become exposed.
    const reach = CRATER_RADIUS + 1;
    const toChunk = (value: number) => Math.floor(value / CHUNK_SIZE);
    const perSide = MAP_SIZE / CHUNK_SIZE;
    for (let cz = toChunk(center.z - reach); cz <= toChunk(center.z + reach); cz++) {
      for (let cx = toChunk(center.x - reach); cx <= toChunk(center.x + reach); cx++) {
        if (cx >= 0 && cx < perSide && cz >= 0 && cz < perSide) this.dirtyChunks.add(cx + cz * perSide);
      }
    }
  }

  protected startReplay(shot: ReplayShot): void {
    this.finishReplay();
    this.replay = {
      shot,
      position: { ...shot.origin },
      velocity: { ...shot.velocity },
      elapsedMs: 0,
      pauseLeftMs: EXPLOSION_PAUSE_MS,
      exploded: false,
    };
  }

  /** Advances one step. Returns true on the step the replay ends. */
  protected tickReplay(): boolean {
    const replay = this.replay;
    if (!replay) return false;
    if (!replay.exploded) {
      replay.elapsedMs += STEP_MS;
      stepProjectile(replay.position, replay.velocity, replay.shot.wind);
      if (replay.elapsedMs >= replay.shot.flightMs) this.reveal(replay);
      return false;
    }
    for (const hit of replay.shot.hits) {
      const { body } = this.player(hit.playerId);
      if (!isDrowned(body.y)) stepBody(this.terrain, body);
    }
    replay.pauseLeftMs -= STEP_MS;
    if (replay.pauseLeftMs > 0) return false;
    this.finishReplay();
    return true;
  }

  /** Jumps to the end. The computed result is the truth, whatever the animation ended up doing. */
  protected finishReplay(): void {
    const replay = this.replay;
    if (!replay) return;
    if (!replay.exploded) this.reveal(replay);
    for (const hit of replay.shot.hits) {
      const player = this.player(hit.playerId);
      player.body = { ...createBody(hit.finalPos), grounded: true };
      player.alive = !hit.died;
    }
    this.replay = null;
  }

  private reveal(replay: Replay): void {
    replay.exploded = true;
    const { impact, hits } = replay.shot;
    if (impact) {
      this.carve(impact);
      this.effects.push({ kind: 'explosion', at: impact });
    } else if (replay.position.y < WATER_SURFACE + 1) {
      this.effects.push({ kind: 'splash', at: { ...replay.position } });
    }
    for (const hit of hits) {
      const player = this.player(hit.playerId);
      player.hp = hit.hpAfter;
      player.body.vx = hit.knockback.x;
      player.body.vy = hit.knockback.y;
      player.body.vz = hit.knockback.z;
      player.body.grounded = false;
    }
  }
}

import { MAX_PITCH, POSE_INTERVAL_MS } from '../../shared/game/constants';
import { createBody, stepBody } from '../../shared/game/player';
import {
  aimToVelocity,
  chargeLevel,
  muzzlePosition,
  powerFromCharge,
  simulateProjectile,
  type Wind,
} from '../../shared/game/projectile';
import { generateTerrain, type Vec3 } from '../../shared/game/terrain';
import { turnQueue, type Outcome, type Team, type TurnOrder } from '../../shared/game/turns';
import type { FrameInput } from '../input/input';
import { MatchCore, STEP_MS, type ReplayShot } from './matchCore';
import type { MatchPlayer, MatchView, Phase } from './matchView';
import { PosePlayback } from './posePlayback';

export type ServerPlayer = Vec3 & {
  id: string;
  team: Team;
  name: string;
  hp: number;
  alive: boolean;
  yaw: number;
  pitch: number;
};

export type GameSnapshot = {
  seed: number;
  status: 'active' | 'finished';
  winner: Outcome;
  phase: 'aiming' | 'resolving' | 'retreat';
  turnNumber: number;
  activePlayerId: string;
  phaseEndsAt: number;
  chargeStartedAt: number | null;
  wind: Wind;
  order: TurnOrder;
  myPlayerId: string | null;
  players: ServerPlayer[];
  craters: Vec3[];
  lastShot: (ReplayShot & { turnNumber: number }) | null;
};

export type LivePose = Vec3 & {
  playerId: string;
  turnNumber: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** When the active player sent this, by their clock. Null until they have sent anything this turn. */
  sentAt: number | null;
};

export type PoseReport = Vec3 & { yaw: number; pitch: number; grounded: boolean; sentAt: number };

/** How the match talks to the server. Each returns when the server has answered. */
export type MatchTransport = {
  sendPose(turnNumber: number, pose: PoseReport): Promise<unknown>;
  beginCharge(): Promise<unknown>;
  fire(power: number, pose: PoseReport): Promise<unknown>;
};

/**
 * A client's view of a match the server runs. The server decides everything; this
 * predicts the local player's own walking, follows other players, and replays shots.
 */
export class NetworkMatch extends MatchCore implements MatchView {
  readonly myPlayerId: string | null;
  turnNumber: number;
  wind: Wind;
  activeId: string;
  winner: Outcome;
  serverPhase: GameSnapshot['phase'];
  status: GameSnapshot['status'];

  private snapshot: GameSnapshot;
  private playback = new PosePlayback();
  private clockOffsetMs = 0;
  private carvedCount = 0;
  private replayedTurn = 0;
  /** True while this client's walking, rather than the server's stored position, places the local player. */
  private ownsBody = false;
  private chargeMs: number | null = null;
  private fireNeedsRelease = true;
  private fireSent = false;
  private poseInFlight = false;
  private lastPoseKey = '';
  private poseCooldownMs = 0;

  constructor(
    initial: GameSnapshot,
    private readonly transport: MatchTransport,
  ) {
    super(
      generateTerrain(initial.seed),
      initial.players.map((p) => ({
        id: p.id,
        team: p.team,
        name: p.name,
        hp: p.hp,
        alive: p.alive,
        body: { ...createBody(p), grounded: true },
        yaw: p.yaw,
        pitch: p.pitch,
        walking: false,
      })),
    );
    this.myPlayerId = initial.myPlayerId;
    this.snapshot = initial;
    this.turnNumber = initial.turnNumber;
    this.wind = initial.wind;
    this.activeId = initial.activePlayerId;
    this.winner = initial.winner;
    this.serverPhase = initial.phase;
    this.status = initial.status;
    // Whatever already happened before this client arrived isn't worth replaying.
    for (const crater of initial.craters) this.carve(crater);
    this.carvedCount = initial.craters.length;
    this.replayedTurn = initial.lastShot?.turnNumber ?? 0;
  }

  get active(): MatchPlayer {
    return this.player(this.activeId);
  }

  get turnQueue(): string[] {
    return turnQueue(this.activeId, this.snapshot.order, (id) => this.player(id).alive);
  }

  get controllable(): boolean {
    return this.myPlayerId === this.activeId && this.status === 'active';
  }

  /** What to show: a replay still running reads as resolving, even if the server has moved on. */
  get phase(): Phase {
    if (this.isReplaying) return 'resolving';
    return this.status === 'finished' ? 'finished' : this.serverPhase;
  }

  get phaseMsLeft(): number {
    return Math.max(0, this.snapshot.phaseEndsAt - this.serverNow());
  }

  get power(): number {
    const held = this.heldMs();
    return held === null ? 0 : powerFromCharge(held);
  }

  get chargeLevel(): number {
    const held = this.heldMs();
    return held === null ? 0 : chargeLevel(held);
  }

  private heldMs(): number | null {
    if (this.chargeMs !== null) return this.chargeMs;
    if (this.myPlayerId === this.activeId) return null; // My own bar never waits on the server.
    const started = this.snapshot.chargeStartedAt;
    return started === null ? null : this.serverNow() - started;
  }

  get showAimUi(): boolean {
    return this.controllable && this.phase === 'aiming';
  }

  /** `serverNow - clientNow`, measured once the client has asked the server for the time. */
  setClockOffset(offsetMs: number): void {
    this.clockOffsetMs = offsetMs;
  }

  private serverNow(): number {
    return Date.now() + this.clockOffsetMs;
  }

  /** Takes in the server's latest state. Safe to call with any update, in any phase. */
  sync(next: GameSnapshot): void {
    const newTurn = next.turnNumber !== this.turnNumber || next.activePlayerId !== this.activeId;
    this.snapshot = next;
    this.turnNumber = next.turnNumber;
    this.wind = next.wind;
    this.activeId = next.activePlayerId;
    this.winner = next.winner;
    this.serverPhase = next.phase;
    this.status = next.status;

    if (newTurn) {
      this.finishReplay(); // A late client mustn't let the previous shot overlap the new turn.
      this.ownsBody = false;
      this.fireSent = false;
      this.fireNeedsRelease = true;
      this.chargeMs = null;
      this.playback = new PosePlayback();
      this.lastPoseKey = '';
    }
    if (next.phase !== 'aiming') this.chargeMs = null;

    const shot = next.lastShot;
    const isNewShot = shot !== null && shot.turnNumber > this.replayedTurn;
    const liveReplay = isNewShot && next.phase === 'resolving' && shot.turnNumber === next.turnNumber;
    // A crater the replay will carve itself is excluded; anything older was missed, so catch up at once.
    const endOfCatchUp = liveReplay && shot.impact ? next.craters.length - 1 : next.craters.length;
    for (const crater of next.craters.slice(this.carvedCount, endOfCatchUp)) this.carve(crater);
    this.carvedCount = Math.max(this.carvedCount, next.craters.length);
    if (isNewShot) this.replayedTurn = shot.turnNumber;
    if (liveReplay) {
      this.ownsBody = false;
      this.jumpToNewestPose();
      this.adoptShot(shot);
    } else if (isNewShot) {
      this.cancelPrediction();
    }

    if (!this.isReplaying) this.applyServerPlayers();
  }

  /** Takes in the active player's reported position, when that isn't this client. */
  syncPose(pose: LivePose | null): void {
    if (!pose || pose.sentAt === null || this.isReplaying) return;
    if (pose.turnNumber !== this.turnNumber || pose.playerId !== this.activeId) return;
    this.playback.push({ ...pose, sentAt: pose.sentAt }, Date.now());
  }

  /** Playback runs behind, but a shot leaves from where the player really is. */
  private jumpToNewestPose(): void {
    const newest = this.playback.stop();
    if (!newest || this.activeId === this.myPlayerId) return;
    const player = this.active;
    player.body.x = newest.x;
    player.body.y = newest.y;
    player.body.z = newest.z;
    player.body.grounded = newest.grounded;
    player.yaw = newest.yaw;
    player.pitch = newest.pitch;
  }

  private applyServerPlayers(): void {
    for (const server of this.snapshot.players) {
      const player = this.player(server.id);
      player.hp = server.hp;
      player.alive = server.alive;
      if (server.id === this.myPlayerId && this.ownsBody) continue;
      if (server.id === this.activeId && this.playback.hasPose) continue;
      player.body = { ...createBody(server), grounded: true };
      player.yaw = server.yaw;
      player.pitch = server.pitch;
    }
  }

  protected applyAim(input: FrameInput): void {
    if (!this.canAct()) return;
    const player = this.active;
    player.yaw += input.yawDelta;
    player.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, player.pitch + input.pitchDelta));
  }

  private canAct(): boolean {
    return this.controllable && !this.isReplaying && this.serverPhase !== 'resolving' && this.active.alive;
  }

  protected tick(input: FrameInput): void {
    if (!input.fire) this.fireNeedsRelease = false;

    if (this.isReplaying) {
      if (this.tickReplay()) this.applyServerPlayers();
      return;
    }
    if (this.status === 'finished') return;

    if (this.canAct()) {
      this.ownsBody = true;
      this.moveMyself(input);
      if (this.serverPhase === 'aiming') this.updateCharge(input);
      this.reportPose();
    }
  }

  override update(frameMs: number, input: FrameInput): void {
    super.update(frameMs, input);
    // Every frame rather than every step: this position comes from a clock, not from simulating.
    if (this.activeId !== this.myPlayerId && this.status === 'active' && !this.isReplaying) this.followActive();
  }

  private moveMyself(input: FrameInput): void {
    const player = this.active;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const moveX = -sin * input.moveForward + cos * input.moveRight;
    const moveZ = -cos * input.moveForward - sin * input.moveRight;
    player.walking = moveX !== 0 || moveZ !== 0;
    // Damage is the server's call, made from the poses this reports.
    stepBody(this.terrain, player.body, { moveX, moveZ, jump: input.jump });
  }

  private currentPose(): Omit<PoseReport, 'sentAt'> {
    const { body, yaw, pitch } = this.active;
    return { x: body.x, y: body.y, z: body.z, yaw, pitch, grounded: body.grounded };
  }

  private reportPose(): void {
    this.poseCooldownMs -= STEP_MS;
    if (this.poseCooldownMs > 0 || this.poseInFlight) return;
    const pose = this.currentPose();
    const key = JSON.stringify(pose);
    if (key === this.lastPoseKey) return;
    this.lastPoseKey = key;
    this.poseCooldownMs = POSE_INTERVAL_MS;
    this.poseInFlight = true;
    // Never let poses queue up behind a slow connection: the newest one is all that matters.
    this.transport
      .sendPose(this.turnNumber, { ...pose, sentAt: Date.now() })
      .catch(() => {})
      .finally(() => (this.poseInFlight = false));
  }

  private updateCharge(input: FrameInput): void {
    if (this.fireSent) return;
    if (this.chargeMs === null) {
      if (input.fire && !this.fireNeedsRelease) {
        this.chargeMs = 0;
        this.transport.beginCharge().catch(() => {});
      }
      return;
    }
    this.chargeMs += STEP_MS;
    if (!input.fire || powerFromCharge(this.chargeMs) >= 1) {
      const power = powerFromCharge(this.chargeMs);
      this.fireSent = true;
      this.fireNeedsRelease = true;
      this.chargeMs = null;
      const pose = { ...this.currentPose(), sentAt: Date.now() };
      this.predictShot(power);
      // If this fails the server still knows a charge began, and fires when the turn runs out.
      this.transport.fire(power, pose).catch(() => this.cancelPrediction());
    }
  }

  /** A round trip is too slow for the moment of firing, so the shot leaves now and the server's result joins it. */
  private predictShot(power: number): void {
    const { id, body, yaw, pitch } = this.active;
    const origin = muzzlePosition(body, yaw, pitch);
    const velocity = aimToVelocity(yaw, pitch, power);
    const { flightMs } = simulateProjectile({
      terrain: this.terrain,
      shooterId: id,
      origin,
      velocity,
      wind: this.wind,
      players: this.players.filter((p) => p.alive).map((p) => ({ id: p.id, x: p.body.x, y: p.body.y, z: p.body.z })),
    });
    this.startPrediction(origin, velocity, this.wind, flightMs);
  }

  private followActive(): void {
    const pose = this.playback.read(Date.now());
    if (!pose) return;
    const player = this.active;
    player.body.x = pose.x;
    player.body.y = pose.y;
    player.body.z = pose.z;
    player.body.grounded = pose.grounded;
    player.walking = pose.moving;
    player.yaw = pose.yaw;
    player.pitch = pose.pitch;
  }
}

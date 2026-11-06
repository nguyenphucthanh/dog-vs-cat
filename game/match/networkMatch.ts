import { MAX_PITCH, POSE_INTERVAL_MS, SIM_DT } from '../../shared/game/constants';
import { createBody, stepBody } from '../../shared/game/player';
import { powerFromCharge, type Wind } from '../../shared/game/projectile';
import { generateTerrain, type Vec3 } from '../../shared/game/terrain';
import type { Outcome, Team } from '../../shared/game/turns';
import type { FrameInput } from '../input/input';
import { MatchCore, STEP_MS, type ReplayShot } from './matchCore';
import type { MatchPlayer, MatchView, Phase } from './matchView';

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
};

export type PoseReport = Vec3 & { yaw: number; pitch: number; grounded: boolean };

/** How the match talks to the server. Each returns when the server has answered. */
export type MatchTransport = {
  sendPose(turnNumber: number, pose: PoseReport): Promise<unknown>;
  beginCharge(): Promise<unknown>;
  fire(power: number, pose: PoseReport): Promise<unknown>;
};

const FOLLOW_RATE = 10; // How quickly another player's body catches up with their reported pose.
const SNAP_DISTANCE = 6;
const WALKING_EPSILON = 0.002;
const FOLLOW_STEP = 1 - Math.exp(-SIM_DT * FOLLOW_RATE);

function shortestAngle(from: number, to: number): number {
  const difference = (to - from) % (Math.PI * 2);
  return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

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
  private target: LivePose | null = null;
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
    if (this.chargeMs !== null) return powerFromCharge(this.chargeMs);
    const started = this.snapshot.chargeStartedAt;
    return started === null ? 0 : powerFromCharge(this.serverNow() - started);
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
      this.target = null;
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
      this.target = null;
      this.startReplay(shot);
    }

    if (!this.isReplaying) this.applyServerPlayers();
  }

  /** Takes in the active player's reported position, when that isn't this client. */
  syncPose(pose: LivePose | null): void {
    this.target = pose && pose.turnNumber === this.turnNumber && pose.playerId === this.activeId ? pose : null;
  }

  private applyServerPlayers(): void {
    for (const server of this.snapshot.players) {
      const player = this.player(server.id);
      player.hp = server.hp;
      player.alive = server.alive;
      if (server.id === this.myPlayerId && this.ownsBody) continue;
      if (server.id === this.activeId && this.target) continue;
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
    } else if (this.activeId !== this.myPlayerId) {
      this.followActive();
    }
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

  private poseReport(): PoseReport {
    const { body, yaw, pitch } = this.active;
    return { x: body.x, y: body.y, z: body.z, yaw, pitch, grounded: body.grounded };
  }

  private reportPose(): void {
    this.poseCooldownMs -= STEP_MS;
    if (this.poseCooldownMs > 0 || this.poseInFlight) return;
    const pose = this.poseReport();
    const key = JSON.stringify(pose);
    if (key === this.lastPoseKey) return;
    this.lastPoseKey = key;
    this.poseCooldownMs = POSE_INTERVAL_MS;
    this.poseInFlight = true;
    // Never let poses queue up behind a slow connection: the newest one is all that matters.
    this.transport
      .sendPose(this.turnNumber, pose)
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
      this.transport.fire(power, this.poseReport()).catch(() => {});
    }
  }

  private followActive(): void {
    const target = this.target;
    if (!target) return;
    const player = this.active;
    const { body } = player;
    const dx = target.x - body.x;
    const dy = target.y - body.y;
    const dz = target.z - body.z;
    if (Math.hypot(dx, dy, dz) > SNAP_DISTANCE) {
      body.x = target.x;
      body.y = target.y;
      body.z = target.z;
    } else {
      body.x += dx * FOLLOW_STEP;
      body.y += dy * FOLLOW_STEP;
      body.z += dz * FOLLOW_STEP;
    }
    body.grounded = target.grounded;
    player.walking = Math.hypot(dx, dz) * FOLLOW_STEP > WALKING_EPSILON;
    player.yaw += shortestAngle(player.yaw, target.yaw) * FOLLOW_STEP;
    player.pitch += (target.pitch - player.pitch) * FOLLOW_STEP;
  }
}

import { MAX_HP, MAX_PITCH, RETREAT_MS, SPAWN_PITCH, TURN_MS } from '../../shared/game/constants';
import { resolveShot } from '../../shared/game/explosion';
import { createBody, isDrowned, settleBody, stepBody } from '../../shared/game/player';
import { aimToVelocity, chargeLevel, muzzlePosition, powerFromCharge, type Wind } from '../../shared/game/projectile';
import { generateTerrain, pickSpawns, spawnYaw, type Vec3 } from '../../shared/game/terrain';
import {
  createTurnOrder,
  matchOutcome,
  nextTurn,
  turnQueue,
  type Outcome,
  type Team,
  type TurnOrder,
} from '../../shared/game/turns';
import { initialWind, nextWind } from '../../shared/game/wind';
import type { FrameInput } from '../input/input';
import { MatchCore, STEP_MS } from './matchCore';
import type { MatchPlayer, MatchView, Phase } from './matchView';

/** A hot-seat match running entirely on this machine, for tuning how the game feels. */
export class LocalMatch extends MatchCore implements MatchView {
  readonly seed: number;
  readonly myPlayerId = null;
  readonly controllable = true;
  phase: Phase = 'aiming';
  phaseMsLeft = TURN_MS;
  turnNumber = 1;
  wind: Wind;
  activeId: string;
  chargeMs: number | null = null;
  winner: Outcome = null;

  private order: TurnOrder;
  private fireNeedsRelease = false;

  constructor(seed: number, teamSize = 2) {
    const terrain = generateTerrain(seed);
    const spawns = pickSpawns(terrain, seed, teamSize, teamSize);
    const makeTeam = (team: Team, spots: Vec3[]) =>
      spots.map<MatchPlayer>((spot, i) => ({
        id: `${team}${i + 1}`,
        team,
        name: `${team === 'dog' ? 'Chó' : 'Mèo'} ${i + 1}`,
        hp: MAX_HP,
        alive: true,
        body: { ...createBody(spot), grounded: true }, // Spawns stand exactly on the ground.
        yaw: spawnYaw(spot),
        pitch: SPAWN_PITCH,
        walking: false,
      }));
    super(terrain, [...makeTeam('dog', spawns.dog), ...makeTeam('cat', spawns.cat)]);
    this.seed = seed;
    this.wind = initialWind(seed);
    const idsOf = (team: Team) => this.players.filter((p) => p.team === team).map((p) => p.id);
    const first = nextTurn(createTurnOrder(seed, idsOf('dog'), idsOf('cat')), () => true);
    if (!first) throw new Error('A match needs players');
    this.order = first.order;
    this.activeId = first.playerId;
  }

  get active(): MatchPlayer {
    return this.player(this.activeId);
  }

  get turnQueue(): string[] {
    return turnQueue(this.activeId, this.order, (id) => this.player(id).alive);
  }

  get power(): number {
    return this.chargeMs === null ? 0 : powerFromCharge(this.chargeMs);
  }

  get chargeLevel(): number {
    return this.chargeMs === null ? 0 : chargeLevel(this.chargeMs);
  }

  get showAimUi(): boolean {
    return this.phase === 'aiming';
  }

  protected applyAim(input: FrameInput): void {
    if (this.phase !== 'aiming' && this.phase !== 'retreat') return;
    const player = this.active;
    player.yaw += input.yawDelta;
    player.pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, player.pitch + input.pitchDelta));
  }

  protected tick(input: FrameInput): void {
    if (!input.fire) this.fireNeedsRelease = false;

    switch (this.phase) {
      case 'aiming':
        this.phaseMsLeft -= STEP_MS;
        this.moveActive(input);
        if (this.phase !== 'aiming') return; // Walked into the sea.
        this.updateCharge(input);
        if (this.phase === 'aiming' && this.phaseMsLeft <= 0) {
          if (this.chargeMs !== null) this.fire();
          else this.endTurn();
        }
        break;
      case 'resolving':
        if (this.tickReplay()) this.afterReplay();
        break;
      case 'retreat':
        this.phaseMsLeft -= STEP_MS;
        this.moveActive(input);
        if (this.phase === 'retreat' && this.phaseMsLeft <= 0) this.endTurn();
        break;
      case 'finished':
        break;
    }
  }

  private moveActive(input: FrameInput): void {
    const player = this.active;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const moveX = -sin * input.moveForward + cos * input.moveRight;
    const moveZ = -cos * input.moveForward - sin * input.moveRight;
    player.walking = moveX !== 0 || moveZ !== 0;
    const damage = stepBody(this.terrain, player.body, { moveX, moveZ, jump: input.jump });
    player.hp = Math.max(0, player.hp - damage);
    if (isDrowned(player.body.y)) player.hp = 0;
    if (player.hp === 0) {
      player.alive = false;
      this.endTurn();
    }
  }

  private updateCharge(input: FrameInput): void {
    if (this.chargeMs === null) {
      if (input.fire && !this.fireNeedsRelease) this.chargeMs = 0;
      return;
    }
    if (!input.fire) {
      this.fire();
      return;
    }
    this.chargeMs += STEP_MS;
    if (powerFromCharge(this.chargeMs) >= 1) this.fire();
  }

  private fire(): void {
    const shooter = this.active;
    const origin = muzzlePosition(shooter.body, shooter.yaw, shooter.pitch);
    const velocity = aimToVelocity(shooter.yaw, shooter.pitch, this.power);
    // The result is worked out on a copy; the visible terrain changes when the replay reaches impact.
    const result = resolveShot({
      terrain: { blocks: this.terrain.blocks.slice() },
      shooterId: shooter.id,
      origin,
      velocity,
      wind: this.wind,
      players: this.players
        .filter((p) => p.alive)
        .map((p) => ({ id: p.id, x: p.body.x, y: p.body.y, z: p.body.z, hp: p.hp })),
    });
    this.startReplay({ origin, velocity, wind: this.wind, ...result });
    this.chargeMs = null;
    this.fireNeedsRelease = true;
    this.phase = 'resolving';
  }

  private afterReplay(): void {
    if (this.active.alive) {
      this.phase = 'retreat';
      this.phaseMsLeft = RETREAT_MS;
    } else {
      this.endTurn();
    }
  }

  private endTurn(): void {
    const player = this.active;
    if (player.alive) {
      const settled = settleBody(this.terrain, player.body);
      player.hp = settled.drowned ? 0 : Math.max(0, player.hp - settled.fallDamage);
      player.alive = player.hp > 0;
    }
    this.chargeMs = null;
    this.fireNeedsRelease = true; // A new turn must start with a fresh press.

    const countAlive = (team: Team) => this.players.filter((p) => p.team === team && p.alive).length;
    this.winner = matchOutcome(countAlive('dog'), countAlive('cat'), this.turnNumber);
    const next = this.winner ? null : nextTurn(this.order, (id) => this.player(id).alive);
    if (!next) {
      this.phase = 'finished';
      return;
    }
    this.order = next.order;
    this.activeId = next.playerId;
    this.turnNumber += 1;
    this.wind = nextWind(this.seed, this.turnNumber, this.wind);
    this.phase = 'aiming';
    this.phaseMsLeft = TURN_MS;
  }
}

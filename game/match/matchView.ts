import type { Body } from '../../shared/game/player';
import type { Wind } from '../../shared/game/projectile';
import type { Terrain, Vec3 } from '../../shared/game/terrain';
import type { Outcome, Team } from '../../shared/game/turns';
import type { FrameInput } from '../input/input';

export type Phase = 'aiming' | 'resolving' | 'retreat' | 'finished';

export type MatchPlayer = {
  id: string;
  team: Team;
  name: string;
  hp: number;
  alive: boolean;
  body: Body;
  yaw: number;
  pitch: number;
  walking: boolean;
};

export type MatchEffect = { kind: 'explosion' | 'splash'; at: Vec3 };

/** Everything the 3D scene and HUD read. A local hot-seat match and a networked one both provide it. */
export interface MatchView {
  readonly terrain: Terrain;
  readonly players: MatchPlayer[];
  readonly phase: Phase;
  readonly phaseMsLeft: number;
  readonly turnNumber: number;
  readonly wind: Wind;
  readonly activeId: string;
  readonly active: MatchPlayer;
  readonly power: number;
  readonly winner: Outcome;
  readonly projectile: { position: Vec3; velocity: Vec3 } | null;
  /** Where the camera should look while a shot plays out. */
  readonly focus: Vec3 | null;
  /** Null in a hot-seat match, where no player is "me". */
  readonly myPlayerId: string | null;
  /** True when this screen's input is what moves the active player. */
  readonly controllable: boolean;
  /** Crosshair and arc preview: only for whoever is aiming on this screen. */
  readonly showAimUi: boolean;
  update(frameMs: number, input: FrameInput): void;
  drainEffects(): MatchEffect[];
  drainDirtyChunks(): number[];
}

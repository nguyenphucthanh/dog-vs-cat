import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARGE_MS, EXPLOSION_PAUSE_MS, TURN_MS } from '../../shared/game/constants';
import { generateTerrain, pickSpawns, topSolidY } from '../../shared/game/terrain';
import type { FrameInput } from '../input/input';
import { NetworkMatch, type GameSnapshot, type LivePose } from './networkMatch';

const SEED = 1;
const IDLE: FrameInput = { moveForward: 0, moveRight: 0, jump: false, fire: false, yawDelta: 0, pitchDelta: 0 };
const WALK: FrameInput = { ...IDLE, moveForward: 1 };
const FIRE: FrameInput = { ...IDLE, fire: true };

function snapshot(overrides: Partial<GameSnapshot> = {}): GameSnapshot {
  const spawns = pickSpawns(generateTerrain(SEED), SEED, 1, 1);
  return {
    seed: SEED,
    status: 'active',
    winner: null,
    phase: 'aiming',
    turnNumber: 1,
    activePlayerId: 'me',
    phaseEndsAt: Date.now() + TURN_MS,
    chargeStartedAt: null,
    wind: { x: 0, z: 0 },
    order: { dog: ['me'], cat: ['them'], dogIndex: 0, catIndex: 0, nextTeam: 'cat' },
    myPlayerId: 'me',
    players: [
      { id: 'me', team: 'dog', name: 'Me', hp: 100, alive: true, ...spawns.dog[0], yaw: 0, pitch: 0.2 },
      { id: 'them', team: 'cat', name: 'Them', hp: 100, alive: true, ...spawns.cat[0], yaw: 0, pitch: 0.2 },
    ],
    craters: [],
    lastShot: null,
    ...overrides,
  };
}

function setup(initial = snapshot()) {
  const transport = {
    sendPose: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
    beginCharge: vi.fn(() => Promise.resolve()),
    fire: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  };
  return { match: new NetworkMatch(initial, transport), transport };
}

function run(match: NetworkMatch, ms: number, input: FrameInput = IDLE) {
  for (let t = 0; t < ms; t += 16) match.update(16, input);
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('NetworkMatch', () => {
  describe('on my turn', () => {
    it('walks immediately and reports poses no faster than the limit', async () => {
      const { match, transport } = setup();
      const startZ = match.active.body.z;
      for (let t = 0; t < 1000; t += 16) {
        match.update(16, WALK);
        await flush();
      }
      expect(startZ - match.active.body.z).toBeGreaterThan(1);
      expect(transport.sendPose.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(transport.sendPose.mock.calls.length).toBeLessThanOrEqual(6);
      expect(transport.sendPose.mock.calls[0][0]).toBe(1);
    });

    it('sends nothing while standing still', async () => {
      const { match, transport } = setup();
      for (let t = 0; t < 1000; t += 16) {
        match.update(16, IDLE);
        await flush();
      }
      expect(transport.sendPose.mock.calls.length).toBeLessThanOrEqual(1);
    });

    it('does not queue poses behind a slow connection', () => {
      const { match, transport } = setup();
      transport.sendPose.mockImplementation(() => new Promise(() => {}));
      run(match, 2000, WALK);
      expect(transport.sendPose).toHaveBeenCalledTimes(1);
    });

    it('charges on press, tells the server, and fires once on release with the power', () => {
      const { match, transport } = setup();
      run(match, 32);
      run(match, CHARGE_MS / 2, FIRE);
      expect(transport.beginCharge).toHaveBeenCalledTimes(1);
      expect(match.power).toBeCloseTo(0.5, 1);
      run(match, 200);
      expect(transport.fire).toHaveBeenCalledTimes(1);
      expect(transport.fire.mock.calls[0][0]).toBeCloseTo(0.5, 1);
      run(match, 500, FIRE);
      expect(transport.fire).toHaveBeenCalledTimes(1);
    });

    it('grows the bar from empty with no jump or stall, while a quick tap keeps minimum power', () => {
      const { match } = setup();
      run(match, 32);
      match.update(32, FIRE);
      const levels = [match.chargeLevel];
      expect(levels[0]).toBeLessThan(0.05);
      expect(match.power).toBeCloseTo(0.15);
      for (let i = 0; i < 40; i++) {
        match.update(16, FIRE);
        levels.push(match.chargeLevel);
      }
      // Every couple of frames the bar has moved on: nothing sits still at the start of a charge.
      for (let i = 2; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 2]);
      expect(levels[40]).toBeCloseTo(0.33, 1);
    });

    it('fires by itself when the bar fills', () => {
      const { match, transport } = setup();
      run(match, 32);
      run(match, CHARGE_MS + 50, FIRE);
      expect(transport.fire).toHaveBeenCalledTimes(1);
      expect(transport.fire.mock.calls[0][0]).toBe(1);
    });

    it('applies server hp without moving me back while I walk', () => {
      const { match } = setup();
      run(match, 500, WALK);
      const z = match.active.body.z;
      const next = snapshot();
      next.players[0].hp = 80;
      match.sync(next);
      expect(match.active.hp).toBe(80);
      expect(match.active.body.z).toBe(z);
    });

    it('ignores mouse and keys when it is not my turn', () => {
      const { match, transport } = setup(snapshot({ activePlayerId: 'them' }));
      const me = match.players.find((p) => p.id === 'me')!;
      const { yaw } = me;
      const z = me.body.z;
      run(match, 500, { ...WALK, fire: true, yawDelta: 0.1 });
      expect(me.yaw).toBe(yaw);
      expect(me.body.z).toBe(z);
      expect(transport.beginCharge).not.toHaveBeenCalled();
      expect(match.controllable).toBe(false);
      expect(match.showAimUi).toBe(false);
    });
  });

  describe('firing without waiting for the server', () => {
    const release = (match: NetworkMatch) => {
      run(match, 32);
      run(match, 400, FIRE);
      run(match, 32);
    };

    it('sends the shot flying the moment fire is released', () => {
      const { match, transport } = setup(snapshot({ wind: { x: 1, z: 0 } }));
      release(match);
      expect(transport.fire).toHaveBeenCalledTimes(1);
      expect(match.projectile).not.toBeNull();
      expect(match.phase).toBe('resolving');
      expect(match.focus).not.toBeNull();
    });

    it('empties the power bar on release even though the server still says charging', () => {
      const { match } = setup();
      run(match, 32);
      run(match, 400, FIRE);
      match.sync(snapshot({ chargeStartedAt: Date.now() - 1000 }));
      expect(match.power).toBeGreaterThan(0);
      run(match, 32);
      expect(match.power).toBe(0);
    });

    it('stops walking once the shot has left', () => {
      const { match } = setup();
      release(match);
      const { z } = match.active.body;
      run(match, 200, WALK);
      expect(match.active.body.z).toBe(z);
    });

    it('waits at the predicted impact without inventing a result', () => {
      const { match } = setup();
      const them = match.players.find((p) => p.id === 'them')!;
      const solid = match.terrain.blocks.filter(Boolean).length;
      match.active.pitch = -1.4; // Straight down: lands almost at once.
      release(match);
      match.drainEffects();
      run(match, 1000);
      const landed = { ...match.projectile!.position };
      run(match, 2000);
      expect(match.phase).toBe('resolving');
      expect(match.projectile!.position).toEqual(landed); // Doesn't sink through the ground while waiting.
      expect(match.drainEffects()).toEqual([]);
      expect(match.terrain.blocks.filter(Boolean).length).toBe(solid);
      expect(them.hp).toBe(100);
    });

    it('joins the server result without restarting the flight', () => {
      const { match } = setup();
      match.active.pitch = 0.9; // Arcs up, so it is still in the air when the answer arrives.
      release(match);
      run(match, 300);
      const flown = { ...match.projectile!.position };
      const origin = { x: flown.x, y: flown.y + 50, z: flown.z };
      const velocity = { ...match.projectile!.velocity };
      const at = { x: 32.5, y: 40, z: 32.5 };
      match.sync(
        snapshot({
          phase: 'resolving',
          craters: [at],
          lastShot: { turnNumber: 1, origin, velocity, wind: { x: 0, z: 0 }, flightMs: 400, impact: at, hits: [] },
        }),
      );
      expect(match.projectile).not.toBeNull();
      // Picked up 300 ms along the real path, not back at its start.
      expect(match.projectile!.position).not.toEqual(origin);
      match.drainEffects();
      run(match, 150);
      expect(match.drainEffects().map((e) => e.kind)).toEqual(['explosion']);
    });

    it('explodes as soon as the answer arrives if the shot already landed', () => {
      const { match } = setup();
      match.active.pitch = -1.4;
      release(match);
      run(match, 1500);
      const { x, y, z } = match.projectile!.position;
      const at = { x, y, z };
      match.drainEffects();
      match.sync(
        snapshot({
          phase: 'resolving',
          craters: [at],
          lastShot: {
            turnNumber: 1,
            origin: at,
            velocity: { x: 0, y: 0, z: 0 },
            wind: { x: 0, z: 0 },
            flightMs: 10,
            impact: at,
            hits: [],
          },
        }),
      );
      run(match, 32);
      expect(match.drainEffects().map((e) => e.kind)).toEqual(['explosion']);
    });

    it('gives control back if the server refuses the shot', async () => {
      const { match, transport } = setup();
      transport.fire.mockImplementation(() => Promise.reject(new Error('refused')));
      release(match);
      await flush();
      expect(match.projectile).toBeNull();
      expect(match.phase).toBe('aiming');
    });

    it('drops the prediction if the turn moves on without it', () => {
      const { match } = setup();
      release(match);
      match.sync(snapshot({ turnNumber: 2, activePlayerId: 'them' }));
      expect(match.projectile).toBeNull();
      expect(match.drainEffects().filter((e) => e.kind === 'splash')).toEqual([]);
    });
  });

  describe('watching someone else', () => {
    const watching = () => setup(snapshot({ activePlayerId: 'them' }));
    const poseOf = (match: NetworkMatch, overrides: Partial<LivePose> = {}): LivePose => {
      const { body, yaw, pitch } = match.active;
      return {
        playerId: 'them',
        turnNumber: 1,
        x: body.x,
        y: body.y,
        z: body.z,
        yaw,
        pitch,
        grounded: true,
        sentAt: Date.now(),
        ...overrides,
      };
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => vi.useRealTimers());

    const play = (match: NetworkMatch, ms: number) => {
      for (let t = 0; t < ms; t += 16) {
        vi.advanceTimersByTime(16);
        match.update(16, IDLE);
      }
    };

    it('walks them at a steady pace between reported positions', () => {
      const { match } = watching();
      const startX = match.active.body.x;
      match.syncPose(poseOf(match));
      play(match, 300);
      match.syncPose(poseOf(match, { x: startX + 1.5 }));
      play(match, 150);
      const halfway = match.active.body.x;
      expect(halfway).toBeGreaterThan(startX);
      expect(halfway).toBeLessThan(startX + 1.5);
      expect(match.active.walking).toBe(true);
      play(match, 2000);
      expect(match.active.body.x).toBe(startX + 1.5);
      expect(match.active.walking).toBe(false);
    });

    it('ignores a pose from an earlier turn, or one nobody has sent yet', () => {
      const { match } = watching();
      const startX = match.active.body.x;
      match.syncPose(poseOf(match, { x: startX + 1, turnNumber: 0 }));
      match.syncPose(poseOf(match, { x: startX + 1, sentAt: null }));
      play(match, 500);
      expect(match.active.body.x).toBe(startX);
    });

    it('fires from where the player really is, even though playback runs behind', () => {
      const { match } = watching();
      const startX = match.active.body.x;
      match.syncPose(poseOf(match));
      play(match, 300);
      match.syncPose(poseOf(match, { x: startX + 1.5 }));
      const at = { x: 32.5, y: 40, z: 32.5 };
      match.sync(
        snapshot({
          activePlayerId: 'them',
          phase: 'resolving',
          craters: [at],
          lastShot: {
            turnNumber: 1,
            origin: at,
            velocity: { x: 0, y: 0, z: 0 },
            wind: { x: 0, z: 0 },
            flightMs: 500,
            impact: at,
            hits: [],
          },
        }),
      );
      expect(match.active.body.x).toBe(startX + 1.5);
    });

    it('shows the charge bar from the server', () => {
      const { match } = watching();
      expect(match.power).toBe(0);
      match.sync(snapshot({ activePlayerId: 'them', chargeStartedAt: Date.now() - CHARGE_MS / 2 }));
      expect(match.power).toBeCloseTo(0.5, 1);
    });
  });

  describe('replaying a shot', () => {
    const impact = () => {
      const terrain = generateTerrain(SEED);
      return { x: 32.5, y: topSolidY(terrain, 32, 32) + 0.5, z: 32.5 };
    };
    const shotAt = (at: ReturnType<typeof impact>, turnNumber = 1) => ({
      turnNumber,
      origin: { x: at.x, y: at.y + 5, z: at.z },
      velocity: { x: 0, y: -10, z: 0 },
      wind: { x: 0, z: 0 },
      flightMs: 300,
      impact: at,
      hits: [
        {
          playerId: 'them',
          damage: 30,
          knockback: { x: 1, y: 3, z: 0 },
          finalPos: { x: at.x + 1, y: at.y + 2, z: at.z },
          hpAfter: 70,
          died: false,
        },
      ],
    });
    const resolvingSnapshot = (at: ReturnType<typeof impact>, hp = 70) => {
      const base = snapshot({ phase: 'resolving', craters: [at], lastShot: shotAt(at) });
      base.players[1] = { ...base.players[1], hp, x: at.x + 1, y: at.y + 2, z: at.z };
      return base;
    };

    it('keeps results hidden until impact, then shows crater, damage and final position', () => {
      const { match } = setup();
      const at = impact();
      const them = match.players.find((p) => p.id === 'them')!;
      const solidBefore = match.terrain.blocks.filter(Boolean).length;
      match.drainDirtyChunks();
      match.drainEffects();

      match.sync(resolvingSnapshot(at));
      expect(match.projectile).not.toBeNull();
      expect(match.phase).toBe('resolving');
      expect(them.hp).toBe(100);
      expect(match.terrain.blocks.filter(Boolean).length).toBe(solidBefore);

      run(match, 350);
      expect(match.projectile).toBeNull();
      expect(them.hp).toBe(70);
      expect(match.terrain.blocks.filter(Boolean).length).toBeLessThan(solidBefore);
      expect(match.drainEffects().map((e) => e.kind)).toEqual(['explosion']);
      expect(match.drainDirtyChunks().length).toBeGreaterThan(0);

      run(match, EXPLOSION_PAUSE_MS + 100);
      expect(them.body.x).toBeCloseTo(at.x + 1);
      expect(them.body.y).toBeCloseTo(at.y + 2);
    });

    it('does not replay the same shot twice or carve twice', () => {
      const { match } = setup();
      const at = impact();
      match.sync(resolvingSnapshot(at));
      run(match, 350);
      const solid = match.terrain.blocks.filter(Boolean).length;
      match.drainEffects();
      match.sync(resolvingSnapshot(at));
      match.sync(resolvingSnapshot(at));
      run(match, 100);
      expect(match.drainEffects()).toEqual([]);
      expect(match.terrain.blocks.filter(Boolean).length).toBe(solid);
    });

    it('lets me move again only after the replay, from where the shot left me', () => {
      const { match } = setup();
      const at = impact();
      const me = match.active;
      match.sync(resolvingSnapshot(at));
      const z = me.body.z;
      run(match, 200, WALK);
      expect(me.body.z).toBe(z);
      match.sync({ ...resolvingSnapshot(at), phase: 'retreat' });
      expect(match.phase).toBe('resolving');
      run(match, 350 + EXPLOSION_PAUSE_MS);
      expect(match.phase).toBe('retreat');
      run(match, 500, WALK);
      expect(me.body.z).toBeLessThan(z);
    });

    it('finishes a running replay when the next turn arrives', () => {
      const { match } = setup();
      const at = impact();
      const them = match.players.find((p) => p.id === 'them')!;
      match.sync(resolvingSnapshot(at));
      const next = resolvingSnapshot(at);
      match.sync({ ...next, phase: 'aiming', turnNumber: 2, activePlayerId: 'them' });
      expect(match.projectile).toBeNull();
      expect(them.hp).toBe(70);
      expect(match.phase).toBe('aiming');
    });

    it('builds old craters at once when joining mid-match, without replaying them', () => {
      const at = impact();
      const fresh = setup();
      const { match } = setup(resolvingSnapshot(at));
      expect(match.projectile).toBeNull();
      expect(match.terrain.blocks.filter(Boolean).length).toBeLessThan(
        fresh.match.terrain.blocks.filter(Boolean).length,
      );
      expect(match.drainEffects()).toEqual([]);
    });

    it('catches up on craters it missed while away', () => {
      const at = impact();
      const { match } = setup();
      const before = match.terrain.blocks.filter(Boolean).length;
      match.sync(
        snapshot({
          turnNumber: 5,
          activePlayerId: 'them',
          craters: [at, { ...at, x: at.x + 8 }],
          lastShot: shotAt({ ...at, x: at.x + 8 }, 4),
        }),
      );
      expect(match.projectile).toBeNull();
      expect(match.terrain.blocks.filter(Boolean).length).toBeLessThan(before);
    });

    it('handles a shot that lands in the water', () => {
      const { match } = setup();
      const at = impact();
      const shot = { ...shotAt(at), impact: null, hits: [], origin: { x: 1, y: 6, z: 1 }, flightMs: 100 };
      match.drainEffects();
      match.sync(snapshot({ phase: 'resolving', lastShot: shot }));
      run(match, 150);
      expect(match.drainEffects().map((e) => e.kind)).toEqual(['splash']);
      expect(match.focus).not.toBeNull();
    });
  });

  it('counts down from the server clock, adjusted for clock difference', () => {
    const { match } = setup(snapshot({ phaseEndsAt: Date.now() + 10_000 }));
    expect(match.phaseMsLeft).toBeGreaterThan(9_000);
    match.setClockOffset(5_000);
    expect(match.phaseMsLeft).toBeLessThanOrEqual(5_000);
    expect(match.phaseMsLeft).toBeGreaterThan(4_000);
    match.setClockOffset(50_000);
    expect(match.phaseMsLeft).toBe(0);
  });

  it("keeps a shot's victim alive in the turn list until the replay reveals the death", () => {
    const at = { x: 32.5, y: 40, z: 32.5 };
    const dying = snapshot({
      phase: 'resolving',
      craters: [at],
      lastShot: {
        turnNumber: 1,
        origin: at,
        velocity: { x: 0, y: 0, z: 0 },
        wind: { x: 0, z: 0 },
        flightMs: 100,
        impact: at,
        hits: [
          { playerId: 'them', damage: 100, knockback: { x: 0, y: 0, z: 0 }, finalPos: at, hpAfter: 0, died: true },
        ],
      },
    });
    dying.players[1] = { ...dying.players[1], hp: 0, alive: false };
    const { match } = setup();
    const version = match.terrainVersion;
    match.sync(dying);
    expect(match.turnQueue).toEqual(['me', 'them']);
    expect(match.players.find((p) => p.id === 'them')!.alive).toBe(true);
    expect(match.terrainVersion).toBe(version);
    run(match, 150);
    expect(match.terrainVersion).toBe(version + 1);
  });

  it('reports the end of the match', () => {
    const { match } = setup();
    const end = snapshot({ status: 'finished', winner: 'dog' });
    match.sync(end);
    expect(match.phase).toBe('finished');
    expect(match.winner).toBe('dog');
    expect(match.controllable).toBe(false);
  });
});

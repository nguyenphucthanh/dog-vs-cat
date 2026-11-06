import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BEDROCK_LAYERS,
  CRATER_RADIUS,
  EXPLOSION_DAMAGE,
  EXPLOSION_RADIUS,
  GRAVITY,
  MAP_HEIGHT,
  MAP_SIZE,
  MAX_FLIGHT_MS,
  MAX_PITCH,
  MAX_TURNS,
  PROJECTILE_SPEED,
  SHOT_TIME_SCALE,
  SIM_DT,
  WALK_SPEED,
  WATER_SURFACE,
  WIND_MAX,
  WIND_MAX_CHANGE,
} from './constants';
import { explosionDamage, explosionKnockback, resolveExplosion, resolveShot } from './explosion';
import { createBody, fallDamage, settleBody, stepBody } from './player';
import {
  aimToVelocity,
  chargeLevel,
  powerFromCharge,
  previewArc,
  simulateProjectile,
  stepProjectile,
} from './projectile';
import {
  Block,
  buildTerrain,
  carveSphere,
  createEmptyTerrain,
  generateTerrain,
  getBlock,
  pickSpawns,
  setBlock,
  topSolidY,
  type Terrain,
} from './terrain';
import { createTurnOrder, matchOutcome, nextTurn, turnQueue } from './turns';
import { initialWind, nextWind } from './wind';

const GROUND_TOP = 10; // Feet height when standing on flatWorld().
const NO_WIND = { x: 0, z: 0 };

function flatWorld(): Terrain {
  const terrain = createEmptyTerrain();
  for (let y = 0; y < GROUND_TOP; y++) {
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 0; x < MAP_SIZE; x++) setBlock(terrain, x, y, z, y < BEDROCK_LAYERS ? Block.Bedrock : Block.Stone);
    }
  }
  return terrain;
}

function runSeconds(seconds: number, step: () => void) {
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) step();
}

afterEach(() => vi.restoreAllMocks());

describe('terrain', () => {
  it('produces identical blocks for the same seed and different blocks for another', () => {
    const a = generateTerrain(1234);
    const b = generateTerrain(1234);
    const c = generateTerrain(1235);
    expect(a.blocks.every((block, i) => block === b.blocks[i])).toBe(true);
    expect(a.blocks.some((block, i) => block !== c.blocks[i])).toBe(true);
  });

  it('avoids functions that could differ between client and server', () => {
    const banned = [
      vi.spyOn(Math, 'random'),
      vi.spyOn(Math, 'sin'),
      vi.spyOn(Math, 'cos'),
      vi.spyOn(Math, 'pow'),
      vi.spyOn(Date, 'now'),
    ];
    generateTerrain(99);
    for (const spy of banned) expect(spy).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3, 42, 1000, -7])('makes an island surrounded by water for seed %i', (seed) => {
    const terrain = generateTerrain(seed);
    const center = topSolidY(terrain, MAP_SIZE / 2, MAP_SIZE / 2);
    expect(center + 1).toBeGreaterThan(WATER_SURFACE);
    for (const [x, z] of [
      [0, 0],
      [MAP_SIZE - 1, 0],
      [0, MAP_SIZE - 1],
      [MAP_SIZE - 1, MAP_SIZE - 1],
    ]) {
      expect(topSolidY(terrain, x, z) + 1).toBeLessThanOrEqual(WATER_SURFACE);
    }
  });

  it('carves a crater of the right radius and keeps bedrock', () => {
    const terrain = flatWorld();
    carveSphere(terrain, { x: 32, y: 9, z: 32, radius: CRATER_RADIUS });
    expect(getBlock(terrain, 32, 9, 32)).toBe(Block.Air);
    expect(getBlock(terrain, 32 + CRATER_RADIUS - 1, 9, 32)).toBe(Block.Air);
    expect(getBlock(terrain, 32 + CRATER_RADIUS + 1, 9, 32)).toBe(Block.Stone);

    carveSphere(terrain, { x: 10, y: 1, z: 10, radius: 5 });
    expect(getBlock(terrain, 10, 1, 10)).toBe(Block.Bedrock);
    expect(getBlock(terrain, 10, BEDROCK_LAYERS, 10)).toBe(Block.Air);
  });

  it('rebuilds the same terrain from seed plus craters', () => {
    const craters = [
      { x: 30, y: 12, z: 30, radius: 3 },
      { x: 31, y: 11, z: 33, radius: 3 },
    ];
    const direct = generateTerrain(5);
    craters.forEach((crater) => carveSphere(direct, crater));
    const rebuilt = buildTerrain(5, craters);
    expect(direct.blocks.every((block, i) => block === rebuilt.blocks[i])).toBe(true);
  });

  it('spawns teams on their own half, on grass, and spaced apart', () => {
    const seed = 77;
    const terrain = generateTerrain(seed);
    const { dog, cat } = pickSpawns(terrain, seed, 4, 4);
    expect(dog.every((p) => p.x < MAP_SIZE / 2)).toBe(true);
    expect(cat.every((p) => p.x >= MAP_SIZE / 2)).toBe(true);
    const everyone = [...dog, ...cat];
    for (const p of everyone) {
      expect(getBlock(terrain, Math.floor(p.x), p.y - 1, Math.floor(p.z))).toBe(Block.Grass);
    }
    for (const a of everyone) {
      for (const b of everyone) {
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(6);
      }
    }
  });
});

describe('projectile', () => {
  const dropHeight = 15;
  const origin = { x: 5, y: WATER_SURFACE + dropHeight, z: 32 };
  const shot = { terrain: createEmptyTerrain(), shooterId: 'me', players: [], origin };

  it('follows a parabola when there is no wind', () => {
    const flight = simulateProjectile({ ...shot, velocity: { x: 20, y: 0, z: 0 }, wind: NO_WIND });
    const expectedTime = Math.sqrt((2 * dropHeight) / GRAVITY);
    expect(flight.outcome).toBe('water');
    expect((flight.flightMs / 1000) * SHOT_TIME_SCALE).toBeCloseTo(expectedTime, 1);
    expect(flight.point.x).toBeCloseTo(origin.x + 20 * expectedTime, 0);
    expect(flight.point.z).toBe(origin.z);
  });

  it('is pushed in the direction of the wind by the expected amount', () => {
    const wind = { x: 0, z: 3 };
    const flight = simulateProjectile({ ...shot, velocity: { x: 20, y: 0, z: 0 }, wind });
    const time = (flight.flightMs / 1000) * SHOT_TIME_SCALE;
    expect(flight.point.z - origin.z).toBeCloseTo(0.5 * 3 * time * time, 0);
  });

  it('explodes on terrain, and fast shots cannot tunnel through a thin wall', () => {
    const terrain = createEmptyTerrain();
    for (let y = 0; y < MAP_HEIGHT; y++) {
      for (let z = 0; z < MAP_SIZE; z++) setBlock(terrain, 30, y, z, Block.Stone);
    }
    const flight = simulateProjectile({
      ...shot,
      terrain,
      origin: { x: 5, y: 15, z: 32 },
      velocity: { x: 120, y: 0, z: 0 },
      wind: NO_WIND,
    });
    expect(flight.outcome).toBe('impact');
    expect(Math.floor(flight.point.x)).toBe(30);
  });

  it('hits a player directly but spares the shooter while leaving the barrel', () => {
    const start = { x: 10, y: 15, z: 32 };
    const players = [
      { id: 'me', ...start },
      { id: 'them', x: 15, y: 15, z: 32 },
    ];
    const flight = simulateProjectile({
      ...shot,
      players,
      origin: { ...start, y: start.y + 1 },
      velocity: { x: 40, y: 0, z: 0 },
      wind: NO_WIND,
    });
    expect(flight.hitPlayerId).toBe('them');
  });

  it('leaves play when it flies far past the edge', () => {
    const flight = simulateProjectile({
      ...shot,
      origin: { x: 60, y: 23, z: 32 },
      velocity: { x: 40, y: 30, z: 0 },
      wind: NO_WIND,
    });
    expect(flight.outcome).toBe('out');
  });

  it('turns aim into velocity, facing -Z at yaw 0 and clamping power', () => {
    const forward = aimToVelocity(0, 0, 1);
    expect(forward.z).toBeCloseTo(-PROJECTILE_SPEED);
    expect(forward.x).toBeCloseTo(0);
    expect(aimToVelocity(0, Math.PI / 2, 1).y).toBeCloseTo(PROJECTILE_SPEED);
    expect(Math.hypot(...Object.values(aimToVelocity(1, 0.3, 99)))).toBeCloseTo(PROJECTILE_SPEED);
    expect(Math.hypot(...Object.values(aimToVelocity(1, 0.3, 0)))).toBeCloseTo(PROJECTILE_SPEED * 0.15);
  });

  it('fills the bar from zero while power keeps its minimum, and they meet above it', () => {
    expect(chargeLevel(0)).toBe(0);
    expect(powerFromCharge(0)).toBeCloseTo(0.15);
    expect(chargeLevel(1000)).toBe(powerFromCharge(1000));
    expect(chargeLevel(99_999)).toBe(1);
    expect(chargeLevel(-50)).toBe(0);
  });

  it('previews only the start of the arc', () => {
    const start = { x: 0, y: 0, z: 0 };
    const points = previewArc(start, { x: 40, y: 0, z: 0 }, 3);
    const last = points[points.length - 1];
    expect(Math.hypot(last.x, last.y, last.z)).toBeCloseTo(3, 0);
  });
});

describe('explosion', () => {
  const feet = { x: 32, y: GROUND_TOP, z: 32 };

  it('deals full damage on a direct hit and falls off to zero at the radius', () => {
    expect(explosionDamage({ x: 32, y: GROUND_TOP + 1, z: 32 }, feet)).toBe(EXPLOSION_DAMAGE);
    const halfway = explosionDamage({ x: 32 + 0.4 + EXPLOSION_RADIUS / 2, y: GROUND_TOP + 1, z: 32 }, feet);
    expect(halfway).toBe(EXPLOSION_DAMAGE / 2);
    expect(explosionDamage({ x: 32 + 0.4 + EXPLOSION_RADIUS, y: GROUND_TOP + 1, z: 32 }, feet)).toBe(0);
  });

  it('knocks players away from the blast and upward, weaker with distance', () => {
    const near = explosionKnockback({ x: 31, y: GROUND_TOP, z: 32 }, feet);
    const far = explosionKnockback({ x: 29, y: GROUND_TOP, z: 32 }, feet);
    expect(near.x).toBeGreaterThan(0);
    expect(near.y).toBeGreaterThan(0);
    expect(Math.hypot(near.x, near.y, near.z)).toBeGreaterThan(Math.hypot(far.x, far.y, far.z));
    expect(explosionKnockback({ x: 10, y: GROUND_TOP, z: 10 }, feet)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('hurts teammates and the shooter alike, and leaves distant players alone', () => {
    const players = [
      { id: 'near', ...feet, hp: 100 },
      { id: 'shooter', x: 33, y: GROUND_TOP, z: 32, hp: 100 },
      { id: 'far', x: 10, y: GROUND_TOP, z: 10, hp: 100 },
    ];
    const hits = resolveExplosion(flatWorld(), { x: 32.5, y: GROUND_TOP, z: 32 }, players);
    expect(hits.map((hit) => hit.playerId).sort()).toEqual(['near', 'shooter']);
    expect(hits.every((hit) => hit.hpAfter < 100)).toBe(true);
  });

  it('kills a player whose damage exceeds their HP', () => {
    const [hit] = resolveExplosion(flatWorld(), { x: 32, y: GROUND_TOP + 1, z: 32 }, [{ id: 'a', ...feet, hp: 10 }]);
    expect(hit.hpAfter).toBe(0);
    expect(hit.died).toBe(true);
  });

  it('drops a player when the ground under them is blown away, even outside the blast radius', () => {
    const terrain = flatWorld();
    // Standing on a thin ledge whose support is removed by a blast that cannot reach them.
    const y = GROUND_TOP + 8;
    setBlock(terrain, 32, y - 1, 32, Block.Stone);
    const [hit] = resolveExplosion(terrain, { x: 32.5, y: y - 1 - CRATER_RADIUS + 0.6, z: 32.5 }, [
      { id: 'a', x: 32.5, y, z: 32.5, hp: 100 },
    ]);
    expect(hit.finalPos.y).toBeLessThan(y);
    expect(hit.damage).toBeGreaterThan(0);
  });

  it('kills a player who ends up in the water', () => {
    const terrain = createEmptyTerrain();
    setBlock(terrain, 32, GROUND_TOP - 1, 32, Block.Stone);
    const [hit] = resolveExplosion(terrain, { x: 32.5, y: GROUND_TOP - 0.5, z: 32.5 }, [
      { id: 'a', x: 32.5, y: GROUND_TOP, z: 32.5, hp: 100 },
    ]);
    expect(hit.hpAfter).toBe(0);
    expect(hit.died).toBe(true);
  });

  it('does nothing when a shot lands in the water', () => {
    const terrain = createEmptyTerrain();
    const result = resolveShot({
      terrain,
      shooterId: 'a',
      origin: { x: 32, y: 8, z: 32 },
      velocity: { x: 0, y: -5, z: 0 },
      wind: NO_WIND,
      players: [{ id: 'b', x: 33, y: 8, z: 32, hp: 100 }],
    });
    expect(result.impact).toBeNull();
    expect(result.hits).toEqual([]);
  });
});

describe('player movement', () => {
  const standing = () => {
    const body = createBody({ x: 32.5, y: GROUND_TOP, z: 32.5 });
    return body;
  };

  it('stands still on the ground without taking damage', () => {
    const terrain = flatWorld();
    const body = standing();
    runSeconds(1, () => expect(stepBody(terrain, body)).toBe(0));
    expect(body.y).toBe(GROUND_TOP);
    expect(body.grounded).toBe(true);
  });

  it('walks at walking speed, even with oversized input', () => {
    const terrain = flatWorld();
    const body = standing();
    runSeconds(2, () => stepBody(terrain, body, { moveX: 3, moveZ: 0, jump: false }));
    expect(body.x - 32.5).toBeCloseTo(WALK_SPEED * 2, 1);
  });

  it('steps up a one-block ledge but is stopped by a two-block wall', () => {
    const terrain = flatWorld();
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 34; x < MAP_SIZE; x++) setBlock(terrain, x, GROUND_TOP, z, Block.Stone);
      setBlock(terrain, 37, GROUND_TOP + 1, z, Block.Stone);
      setBlock(terrain, 37, GROUND_TOP + 2, z, Block.Stone);
    }
    const body = standing();
    runSeconds(4, () => stepBody(terrain, body, { moveX: 1, moveZ: 0, jump: false }));
    expect(body.y).toBe(GROUND_TOP + 1);
    expect(body.x).toBeLessThan(37);
    expect(body.x).toBeGreaterThan(36);
  });

  it('climbs a ledge with a continuous hop, never teleporting', () => {
    const terrain = flatWorld();
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 34; x < MAP_SIZE; x++) setBlock(terrain, x, GROUND_TOP, z, Block.Stone);
    }
    const body = standing();
    let biggestRise = 0;
    let airborneSteps = 0;
    let damage = 0;
    runSeconds(2, () => {
      const before = body.y;
      damage += stepBody(terrain, body, { moveX: 1, moveZ: 0, jump: false });
      biggestRise = Math.max(biggestRise, body.y - before);
      if (!body.grounded) airborneSteps += 1;
    });
    expect(body.y).toBe(GROUND_TOP + 1);
    expect(body.x).toBeGreaterThan(34);
    expect(biggestRise).toBeLessThan(0.2);
    expect(airborneSteps).toBeGreaterThan(5);
    expect(damage).toBe(0);
  });

  it('does not hop forever under a low ceiling', () => {
    const terrain = flatWorld();
    for (let z = 0; z < MAP_SIZE; z++) {
      for (let x = 34; x < MAP_SIZE; x++) setBlock(terrain, x, GROUND_TOP, z, Block.Stone);
      for (let x = 0; x < MAP_SIZE; x++) setBlock(terrain, x, GROUND_TOP + 2, z, Block.Stone);
    }
    const body = standing();
    runSeconds(2, () => stepBody(terrain, body, { moveX: 1, moveZ: 0, jump: false }));
    expect(body.y).toBe(GROUND_TOP);
    expect(body.grounded).toBe(true);
    expect(body.x).toBeLessThan(34);
  });

  it('jumps about 1.5 blocks and lands without damage', () => {
    const terrain = flatWorld();
    const body = standing();
    runSeconds(0.1, () => stepBody(terrain, body));
    let peak = 0;
    let damage = stepBody(terrain, body, { moveX: 0, moveZ: 0, jump: true });
    runSeconds(1, () => {
      damage += stepBody(terrain, body);
      peak = Math.max(peak, body.y);
    });
    expect(peak - GROUND_TOP).toBeCloseTo(1.5, 0);
    expect(body.y).toBe(GROUND_TOP);
    expect(damage).toBe(0);
  });

  it('takes fall damage only above the safe height', () => {
    expect(fallDamage(4)).toBe(0);
    expect(fallDamage(6)).toBe(10);
    const terrain = flatWorld();
    const body = createBody({ x: 32.5, y: GROUND_TOP + 8, z: 32.5 });
    const settled = settleBody(terrain, body);
    expect(settled.fallDamage).toBe(20);
    expect(settled.drowned).toBe(false);
  });

  it('drowns when it falls into the water, including off the map', () => {
    const settled = settleBody(createEmptyTerrain(), createBody({ x: -3, y: 12, z: 5 }));
    expect(settled.drowned).toBe(true);
  });
});

describe('turn order', () => {
  const allAlive = () => true;

  it('alternates teams and cycles within each team, even with uneven teams', () => {
    let order = {
      dog: ['d1', 'd2', 'd3'],
      cat: ['c1'],
      dogIndex: 0,
      catIndex: 0,
      nextTeam: 'dog' as const,
    } as ReturnType<typeof createTurnOrder>;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const turn = nextTurn(order, allAlive)!;
      seen.push(turn.playerId);
      order = turn.order;
    }
    expect(seen).toEqual(['d1', 'c1', 'd2', 'c1', 'd3', 'c1']);
  });

  it('skips dead players and wiped teams', () => {
    const order = { dog: ['d1', 'd2'], cat: ['c1'], dogIndex: 0, catIndex: 0, nextTeam: 'dog' as const };
    expect(nextTurn(order, (id) => id !== 'd1')!.playerId).toBe('d2');
    expect(nextTurn(order, (id) => id === 'c1')!.playerId).toBe('c1');
    expect(nextTurn(order, () => false)).toBeNull();
  });

  it('lists players in the order they will play, with the dead last', () => {
    const order = { dog: ['d1', 'd2', 'd3'], cat: ['c1', 'c2'], dogIndex: 1, catIndex: 1, nextTeam: 'cat' as const };
    expect(turnQueue('d1', order, allAlive)).toEqual(['d1', 'c2', 'd2', 'c1', 'd3']);
    expect(turnQueue('d1', order, (id) => id !== 'c2')).toEqual(['d1', 'c1', 'd2', 'd3', 'c2']);
    expect(turnQueue('d1', order, () => false)).toEqual(['d1', 'd2', 'd3', 'c1', 'c2']);
  });

  it('shuffles reproducibly from the seed and keeps everyone', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect(createTurnOrder(9, ids, ids)).toEqual(createTurnOrder(9, ids, ids));
    expect([...createTurnOrder(9, ids, []).dog].sort()).toEqual(ids);
  });

  it('detects win, loss, draw and the turn cap', () => {
    expect(matchOutcome(1, 1, 5)).toBeNull();
    expect(matchOutcome(0, 2, 5)).toBe('cat');
    expect(matchOutcome(2, 0, 5)).toBe('dog');
    expect(matchOutcome(0, 0, 5)).toBe('draw');
    expect(matchOutcome(1, 1, MAX_TURNS)).toBe('draw');
    expect(matchOutcome(0, 1, MAX_TURNS)).toBe('cat');
  });
});

describe('wind', () => {
  it('is reproducible, stays in range, and only drifts between turns', () => {
    let wind = initialWind(11);
    expect(initialWind(11)).toEqual(wind);
    for (let turn = 1; turn < 200; turn++) {
      const next = nextWind(11, turn, wind);
      expect(nextWind(11, turn, wind)).toEqual(next);
      expect(Math.hypot(next.x, next.z)).toBeLessThanOrEqual(WIND_MAX + 1e-9);
      expect(Math.hypot(next.x - wind.x, next.z - wind.z)).toBeLessThanOrEqual(WIND_MAX_CHANGE + 1e-9);
      wind = next;
    }
  });
});

describe('performance budget', () => {
  it('rebuilds terrain with 200 craters and resolves a shot in under 100 ms', () => {
    const seed = 2024;
    const craters = Array.from({ length: 200 }, (_, i) => ({
      x: 8 + ((i * 7) % 48),
      y: 8 + (i % 8),
      z: 8 + ((i * 13) % 48),
      radius: CRATER_RADIUS,
    }));
    const players = Array.from({ length: 8 }, (_, i) => ({
      id: `p${i}`,
      x: 20.5 + i * 3,
      y: 20,
      z: 32.5,
      hp: 100,
    }));
    const samples: number[] = [];
    for (let run = 0; run < 5; run++) {
      const start = performance.now();
      const terrain = buildTerrain(seed, craters);
      const result = resolveShot({
        terrain,
        shooterId: 'p0',
        origin: { x: 20.5, y: 22, z: 32.5 },
        velocity: aimToVelocity(-Math.PI / 2, 0, 0.4),
        wind: { x: 1, z: 1 },
        players,
      });
      samples.push(performance.now() - start);
      // The budget only means something if the shot really exploded and moved people.
      expect(result.impact).not.toBeNull();
      expect(result.hits.length).toBe(players.length);
    }
    const best = Math.min(...samples);
    console.log(`resolveShot budget: best ${best.toFixed(1)} ms, all ${samples.map((s) => s.toFixed(1)).join(', ')}`);
    expect(best).toBeLessThan(100);
  });
});

describe('how long a shot takes', () => {
  const noPlayers = { shooterId: 'me', players: [] };

  it('stretches the flight without moving the path', () => {
    const velocity = { x: 12, y: 16, z: -8 };
    const wind = { x: 2, z: -1 };
    const position = { x: 10, y: 20, z: 10 };
    const current = { ...velocity };
    const seconds = 1;
    const steps = Math.round(seconds / SIM_DT / SHOT_TIME_SCALE);
    for (let i = 0; i < steps; i++) stepProjectile(position, current, wind);
    // The true parabola, one second of path in: reached after 1 / SHOT_TIME_SCALE seconds of real time.
    expect(position.x).toBeCloseTo(10 + 12 + 0.5 * wind.x, 6);
    expect(position.y).toBeCloseTo(20 + 16 - 0.5 * GRAVITY, 6);
    expect(position.z).toBeCloseTo(10 - 8 + 0.5 * wind.z, 6);
  });

  it('lands the highest possible lob before the flight limit runs out', () => {
    const terrain = generateTerrain(1);
    const flight = simulateProjectile({
      ...noPlayers,
      terrain,
      origin: { x: 32, y: MAP_HEIGHT + 2, z: 32 },
      velocity: aimToVelocity(0, MAX_PITCH, 1),
      wind: { x: 0, z: 0 },
    });
    expect(flight.outcome).not.toBe('out');
    expect(flight.flightMs).toBeLessThan(MAX_FLIGHT_MS);
    expect(flight.flightMs).toBeGreaterThan(4000);
  });
});

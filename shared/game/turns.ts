import { MAX_TURNS } from './constants';
import { createRng, mixSeed, type Rng } from './rng';

export type Team = 'dog' | 'cat';

/** dogIndex/catIndex point at the next player to consider on that team. */
export type TurnOrder = {
  dog: string[];
  cat: string[];
  dogIndex: number;
  catIndex: number;
  nextTeam: Team;
};

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createTurnOrder(seed: number, dogIds: readonly string[], catIds: readonly string[]): TurnOrder {
  const rng = createRng(mixSeed(seed, 4));
  return {
    dog: shuffled(dogIds, rng),
    cat: shuffled(catIds, rng),
    dogIndex: 0,
    catIndex: 0,
    nextTeam: rng() < 0.5 ? 'dog' : 'cat',
  };
}

function firstAlive(ids: readonly string[], start: number, isAlive: (id: string) => boolean): number {
  for (let offset = 0; offset < ids.length; offset++) {
    const index = (start + offset) % ids.length;
    if (isAlive(ids[index])) return index;
  }
  return -1;
}

/**
 * Picks the next player: teams alternate, and each team cycles through its living
 * players. A wiped team is skipped. Returns null when nobody is left.
 */
export function nextTurn(
  order: TurnOrder,
  isAlive: (id: string) => boolean,
): { playerId: string; order: TurnOrder } | null {
  const other: Team = order.nextTeam === 'dog' ? 'cat' : 'dog';
  for (const team of [order.nextTeam, other]) {
    const ids = order[team];
    const key = team === 'dog' ? 'dogIndex' : 'catIndex';
    const index = firstAlive(ids, order[key], isAlive);
    if (index === -1) continue;
    return {
      playerId: ids[index],
      order: {
        ...order,
        [key]: (index + 1) % ids.length,
        nextTeam: team === 'dog' ? 'cat' : 'dog',
      },
    };
  }
  return null;
}

/**
 * Everyone in the order they will play: the active player, then whoever comes up next,
 * then anyone with no turn left. With uneven teams a player can play twice before
 * another, so each appears at their first turn.
 */
export function turnQueue(activeId: string, order: TurnOrder, isAlive: (id: string) => boolean): string[] {
  const queue = new Set([activeId]);
  const everyone = [...order.dog, ...order.cat];
  let upcoming = order;
  for (let i = 0; i < everyone.length * 2; i++) {
    const next = nextTurn(upcoming, isAlive);
    if (!next) break;
    queue.add(next.playerId);
    upcoming = next.order;
  }
  for (const id of everyone) queue.add(id);
  return [...queue];
}

export type Outcome = Team | 'draw' | null;

/** Null while the match continues. `turnNumber` is the count of turns already played. */
export function matchOutcome(aliveDogs: number, aliveCats: number, turnNumber: number): Outcome {
  if (aliveDogs === 0 && aliveCats === 0) return 'draw';
  if (aliveDogs === 0) return 'cat';
  if (aliveCats === 0) return 'dog';
  return turnNumber >= MAX_TURNS ? 'draw' : null;
}

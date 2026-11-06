import { describe, expect, it } from 'vitest';
import { advanceSteps, isTypingIn, matchCues, type CueState } from './sound';

const state = (overrides: Partial<CueState> = {}): CueState => ({
  turnNumber: 1,
  phase: 'aiming',
  controllable: true,
  secondsLeft: 20,
  flying: false,
  won: false,
  grounded: true,
  y: 20,
  ...overrides,
});

describe('matchCues', () => {
  it('stays silent when nothing changes', () => {
    expect(matchCues(state(), state())).toEqual([]);
  });

  it('announces my turn, but not someone else’s', () => {
    expect(matchCues(state({ turnNumber: 1 }), state({ turnNumber: 2 }))).toEqual(['myTurn']);
    expect(matchCues(state({ turnNumber: 1 }), state({ turnNumber: 2, controllable: false }))).toEqual([]);
  });

  it('sounds a shot once, for whoever fired it', () => {
    const flying = state({ flying: true, controllable: false, phase: 'resolving' });
    expect(matchCues(state({ controllable: false }), flying)).toEqual(['fire']);
    expect(matchCues(flying, flying)).toEqual([]);
  });

  it('counts down the last seconds of my own aiming only', () => {
    expect(matchCues(state({ secondsLeft: 6 }), state({ secondsLeft: 5 }))).toEqual(['tick']);
    expect(matchCues(state({ secondsLeft: 7 }), state({ secondsLeft: 6 }))).toEqual([]);
    expect(matchCues(state({ secondsLeft: 1 }), state({ secondsLeft: 0 }))).toEqual([]);
    const watching = { controllable: false };
    expect(matchCues(state({ secondsLeft: 6, ...watching }), state({ secondsLeft: 5, ...watching }))).toEqual([]);
  });

  it('plays the ending once, won or lost', () => {
    const lost = state({ phase: 'finished' });
    const won = state({ phase: 'finished', won: true });
    expect(matchCues(state(), lost)).toEqual(['lose']);
    expect(matchCues(state(), won)).toEqual(['win']);
    expect(matchCues(won, won)).toEqual([]);
  });

  it('sounds a jump on leaving the ground upwards, and a landing on coming back', () => {
    const inAir = state({ grounded: false, y: 20.2 });
    expect(matchCues(state(), inAir)).toEqual(['jump']);
    expect(matchCues(inAir, inAir)).toEqual([]);
    expect(matchCues(inAir, state())).toEqual(['land']);
  });

  it('stays quiet on walking off a ledge until the landing', () => {
    expect(matchCues(state(), state({ grounded: false, y: 19.9 }))).toEqual([]);
  });

  it('does not take being blown up, or the next player, for a jump', () => {
    const resolving = { phase: 'resolving' as const, controllable: false };
    expect(matchCues(state(resolving), state({ ...resolving, grounded: false, y: 21 }))).toEqual([]);
    expect(matchCues(state({ ...resolving, grounded: false }), state(resolving))).toEqual([]);
    const watching = { controllable: false };
    expect(matchCues(state({ ...watching, grounded: false }), state({ ...watching, turnNumber: 2 }))).toEqual([]);
  });
});

describe('advanceSteps', () => {
  const walkFor = (ms: number, walking: (t: number) => boolean) => {
    let timerMs = 314;
    let steps = 0;
    for (let t = 0; t < ms; t += 16) {
      const next = advanceSteps(timerMs, 16, walking(t));
      timerMs = next.timerMs;
      if (next.step) steps++;
    }
    return steps;
  };

  it('steps at once on setting off, then at a steady pace', () => {
    expect(walkFor(32, () => true)).toBe(1);
    const steps = walkFor(3200, () => true);
    expect(steps).toBeGreaterThanOrEqual(9);
    expect(steps).toBeLessThanOrEqual(11);
  });

  it('is silent standing still', () => {
    expect(walkFor(3000, () => false)).toBe(0);
  });

  it('does not rush when walking keeps flickering on and off', () => {
    expect(walkFor(3200, (t) => Math.floor(t / 48) % 2 === 0)).toBeLessThanOrEqual(11);
  });
});

describe('isTypingIn', () => {
  it('leaves the M key alone while typing a name or room code', () => {
    expect(isTypingIn({ tagName: 'INPUT' })).toBe(true);
    expect(isTypingIn({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingIn({ tagName: 'BODY' })).toBe(false);
    expect(isTypingIn(null)).toBe(false);
  });
});

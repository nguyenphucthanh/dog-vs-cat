import { describe, expect, it } from 'vitest';
import { matchCues, type CueState } from './sound';

const state = (overrides: Partial<CueState> = {}): CueState => ({
  turnNumber: 1,
  phase: 'aiming',
  controllable: true,
  secondsLeft: 20,
  flying: false,
  won: false,
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
});

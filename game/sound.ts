import { useCallback, useEffect, useState } from 'react';
import type { MatchEffect, MatchView } from './match/matchView';

/** Every sound is synthesised, so there are no audio files to load or license. */
export type Cue = 'fire' | 'myTurn' | 'tick' | 'win' | 'lose';
type Sound = Cue | MatchEffect['kind'];

const MUTE_KEY = 'dog-vs-cat:muted';
const COUNTDOWN_FROM_SECONDS = 5;
const MASTER_VOLUME = 0.6;

export type CueState = {
  turnNumber: number;
  phase: MatchView['phase'];
  controllable: boolean;
  secondsLeft: number;
  flying: boolean;
  won: boolean;
};

export function readCueState(match: MatchView): CueState {
  const myTeam = match.players.find((p) => p.id === match.myPlayerId)?.team;
  return {
    turnNumber: match.turnNumber,
    phase: match.phase,
    controllable: match.controllable,
    secondsLeft: Math.ceil(match.phaseMsLeft / 1000),
    flying: match.projectile !== null,
    won: myTeam ? match.winner === myTeam : true, // A hot-seat match has no losing side on this screen.
  };
}

/** Which sounds a change in the match calls for. */
export function matchCues(previous: CueState, next: CueState): Cue[] {
  const cues: Cue[] = [];
  if (next.flying && !previous.flying) cues.push('fire');
  if (next.turnNumber !== previous.turnNumber && next.controllable && next.phase === 'aiming') cues.push('myTurn');
  const countingDown =
    next.controllable &&
    next.phase === 'aiming' &&
    next.secondsLeft !== previous.secondsLeft &&
    next.secondsLeft > 0 &&
    next.secondsLeft <= COUNTDOWN_FROM_SECONDS;
  if (countingDown) cues.push('tick');
  if (next.phase === 'finished' && previous.phase !== 'finished') cues.push(next.won ? 'win' : 'lose');
  return cues;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let chargeHum: { oscillator: OscillatorNode; gain: GainNode } | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function audio() {
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(context.destination);
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  return { context, master: master!, noise: noise! };
}

function envelope(volume: number, startAt: number, seconds: number): GainNode {
  const { context, master } = audio();
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.001, startAt + seconds);
  gain.connect(master);
  return gain;
}

function tone(type: OscillatorType, from: number, to: number, seconds: number, volume: number, delay = 0) {
  const { context } = audio();
  const startAt = context.currentTime + delay;
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(from, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(to, startAt + seconds);
  oscillator.connect(envelope(volume, startAt, seconds));
  oscillator.start(startAt);
  oscillator.stop(startAt + seconds);
}

function burst(type: BiquadFilterType, from: number, to: number, seconds: number, volume: number) {
  const { context, noise } = audio();
  const startAt = context.currentTime;
  const source = context.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, startAt);
  filter.frequency.exponentialRampToValueAtTime(to, startAt + seconds);
  source.connect(filter);
  filter.connect(envelope(volume, startAt, seconds));
  source.start(startAt);
  source.stop(startAt + seconds);
}

function melody(notes: number[], secondsEach: number) {
  notes.forEach((note, i) => tone('triangle', note, note, secondsEach * 1.6, 0.35, i * secondsEach));
}

const SOUNDS: Record<Sound, () => void> = {
  fire() {
    burst('lowpass', 3000, 300, 0.25, 0.6);
    tone('square', 180, 60, 0.15, 0.2);
  },
  explosion() {
    burst('lowpass', 1500, 100, 1, 1);
    tone('sine', 90, 30, 0.7, 0.9);
  },
  splash: () => burst('bandpass', 1800, 500, 0.5, 0.5),
  myTurn: () => melody([660, 880], 0.12),
  tick: () => tone('square', 1000, 1000, 0.05, 0.08),
  win: () => melody([523, 659, 784, 1047], 0.13),
  lose: () => melody([392, 330, 262], 0.2),
};

/** Browsers keep audio silent until the player has done something, and before that there's nothing to play. */
export function playSound(sound: Sound): void {
  if (context?.state === 'running') SOUNDS[sound]();
}

/** A rising hum while a shot charges. Zero stops it. */
function setChargeHum(level: number): void {
  if (context?.state !== 'running') return;
  if (level <= 0) {
    chargeHum?.oscillator.stop();
    chargeHum = null;
    return;
  }
  if (!chargeHum) {
    const { context, master } = audio();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sawtooth';
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start();
    chargeHum = { oscillator, gain };
  }
  chargeHum.oscillator.frequency.value = 120 + level * 500;
}

/** Plays whatever the match calls for, for as long as the component is mounted. */
export function useMatchSounds(match: MatchView): void {
  useEffect(() => {
    let previous = { ...readCueState(match), turnNumber: 0 }; // So the first turn is announced too.
    let frame = requestAnimationFrame(function loop() {
      const next = readCueState(match);
      for (const cue of matchCues(previous, next)) playSound(cue);
      setChargeHum(match.chargeLevel);
      previous = next;
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      setChargeHum(0);
    };
  }, [match]);
}

/** Unlocks audio on the first input, and handles muting with the M key. */
export function useSoundControls(): { muted: boolean; toggleMuted: () => void } {
  const [isMuted, setIsMuted] = useState(muted);
  const toggleMuted = useCallback(() => {
    muted = !muted;
    setIsMuted(muted);
    if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
    try {
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      // Without storage the choice only lasts until the page reloads.
    }
  }, []);

  useEffect(() => {
    const unlock = () => void audio().context.resume();
    const onKeyDown = (event: KeyboardEvent) => {
      unlock();
      if (event.code === 'KeyM' && !event.repeat && !event.metaKey && !event.ctrlKey) toggleMuted();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [toggleMuted]);

  return { muted: isMuted, toggleMuted };
}

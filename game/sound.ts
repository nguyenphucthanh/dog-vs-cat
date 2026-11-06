'use client';

import { useEffect, useSyncExternalStore } from 'react';
import type { MatchEffect, MatchView } from './match/matchView';
import { windDrift } from './scene/windDrift';

/** Every sound is synthesised, so there are no audio files to load or license. */
export type Cue = 'fire' | 'myTurn' | 'tick' | 'win' | 'lose' | 'jump' | 'land';
type Sound = Cue | MatchEffect['kind'] | 'step';

const MUTE_KEY = 'dog-vs-cat:muted';
const COUNTDOWN_FROM_SECONDS = 5;
const MASTER_VOLUME = 0.6;
const MUSIC_URL = '/music/game-bg-music.ogg';
const MUSIC_VOLUME = 0.3; // Under the master volume, and well below the sound effects it plays behind.
const STEP_INTERVAL_MS = 314; // Two footfalls per walk cycle of the legs in Character.tsx.
const NOISE_SECONDS = 4; // Long enough that the wind's loop can't be heard repeating.
const WIND_VOLUME = 0.16; // At full strength.
const WIND_LOW_HZ = 300;
const WIND_HIGH_HZ = 1000;
const WIND_EASE_SECONDS = 0.4; // How quickly the sound follows a gust or a new turn's wind.

export type CueState = {
  turnNumber: number;
  phase: MatchView['phase'];
  controllable: boolean;
  secondsLeft: number;
  flying: boolean;
  won: boolean;
  grounded: boolean;
  y: number;
};

export function readCueState(match: MatchView): CueState {
  const myTeam = match.players.find((p) => p.id === match.myPlayerId)?.team;
  const { body } = match.active;
  return {
    grounded: body.grounded,
    y: body.y,
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

  // Being blown about by a shot, or the camera moving on to another player, isn't jumping.
  const sameBody = next.turnNumber === previous.turnNumber && next.phase !== 'resolving' && next.phase !== 'finished';
  if (sameBody && previous.grounded && !next.grounded && next.y > previous.y) cues.push('jump');
  if (sameBody && !previous.grounded && next.grounded) cues.push('land');
  return cues;
}

/** The time since the last footfall, and whether another one is due. Stopping for a moment can't make steps rush. */
export function advanceSteps(timerMs: number, frameMs: number, walking: boolean): { timerMs: number; step: boolean } {
  const timer = Math.min(STEP_INTERVAL_MS, timerMs + frameMs);
  return walking && timer >= STEP_INTERVAL_MS ? { timerMs: 0, step: true } : { timerMs: timer, step: false };
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let chargeHum: { oscillator: OscillatorNode; gain: GainNode } | null = null;
let windNoise: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null = null;
let muted = readMuted();
const muteListeners = new Set<() => void>();

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
    noise = context.createBuffer(1, context.sampleRate * NOISE_SECONDS, context.sampleRate);
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
  source.start(startAt, Math.random() * NOISE_SECONDS); // A different stretch each time, so no two sound identical.
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
  step: () => burst('lowpass', 350 + Math.random() * 250, 120, 0.09, 0.3),
  jump() {
    burst('lowpass', 700, 250, 0.1, 0.2);
    tone('triangle', 220, 480, 0.13, 0.18);
  },
  land() {
    burst('lowpass', 500, 80, 0.14, 0.45);
    tone('sine', 120, 50, 0.1, 0.3);
  },
};

/** Browsers keep audio silent until the player has done something, and before that there's nothing to play. */
export function playSound(sound: Sound): void {
  if (context?.state === 'running') SOUNDS[sound]();
}

/** A rising hum while a shot charges. Zero stops it. */
function setChargeHum(level: number): void {
  if (level <= 0) {
    chargeHum?.oscillator.stop();
    chargeHum = null;
    return;
  }
  if (context?.state !== 'running') return;
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

/** Air rushing past, louder and higher as `amount` goes from 0 to 1. Gusts come and go by themselves. */
function setWindNoise(amount: number, seconds: number): void {
  if (amount <= 0) {
    windNoise?.source.stop();
    windNoise = null;
    return;
  }
  if (context?.state !== 'running') return;
  if (!windNoise) {
    const { context, master, noise } = audio();
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start();
    windNoise = { source, filter, gain };
  }
  const gust = 0.75 + 0.15 * Math.sin(seconds * 0.7) + 0.1 * Math.sin(seconds * 1.9);
  const now = windNoise.source.context.currentTime;
  windNoise.gain.gain.setTargetAtTime(WIND_VOLUME * amount * amount * gust, now, WIND_EASE_SECONDS);
  windNoise.filter.frequency.setTargetAtTime(
    (WIND_LOW_HZ + (WIND_HIGH_HZ - WIND_LOW_HZ) * amount) * gust,
    now,
    WIND_EASE_SECONDS,
  );
}

/** Plays whatever the match calls for, for as long as the component is mounted. */
export function useMatchSounds(match: MatchView): void {
  useEffect(() => {
    let previous = { ...readCueState(match), turnNumber: 0 }; // So the first turn is announced too.
    let stepTimerMs = STEP_INTERVAL_MS;
    let lastFrameAt = performance.now();
    let frame = requestAnimationFrame(function loop(now) {
      const next = readCueState(match);
      for (const cue of matchCues(previous, next)) playSound(cue);
      setChargeHum(match.chargeLevel);
      setWindNoise(next.phase === 'finished' ? 0 : windDrift(match.wind).amount, now / 1000);

      const { walking, alive } = match.active;
      const steps = advanceSteps(stepTimerMs, now - lastFrameAt, walking && next.grounded && alive);
      stepTimerMs = steps.timerMs;
      if (steps.step) playSound('step');

      lastFrameAt = now;
      previous = next;
      frame = requestAnimationFrame(loop);
    });
    return () => {
      cancelAnimationFrame(frame);
      setChargeHum(0);
      setWindNoise(0, 0);
    };
  }, [match]);
}

/** Decoded whole rather than streamed, because only that loops with no gap at the seam. */
async function startMusic(): Promise<void> {
  const { context, master } = audio();
  const response = await fetch(MUSIC_URL);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = context.createGain();
  gain.gain.value = MUSIC_VOLUME;
  source.connect(gain);
  gain.connect(master);
  source.start();
}

/**
 * Lives in the root layout, so music carries on across every screen. Browsers keep audio
 * silent until the player has done something, so everything starts from the first input.
 */
export function AudioUnlock(): null {
  useEffect(() => {
    let musicStarted = false;
    const unlock = () => {
      void audio().context.resume();
      if (musicStarted) return;
      musicStarted = true;
      startMusic().catch(() => {}); // A browser that can't play this format still has all the other sounds.
    };
    // Frames stop in a hidden tab, which would leave the wind and the charge hum droning on with nothing to end them.
    const onVisibilityChange = () => {
      if (document.hidden) void context?.suspend();
      else if (musicStarted) void context?.resume();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('touchend', unlock); // iPhones only allow audio to start from here.
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchend', unlock);
      window.removeEventListener('keydown', unlock);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  return null;
}

/** Whether a key press here is someone typing, rather than a command to the game. */
export function isTypingIn(target: { tagName?: string } | null): boolean {
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
}

function toggleMuted(): void {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Without storage the choice only lasts until the page reloads.
  }
  muteListeners.forEach((listener) => listener());
}

function subscribeToMute(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

/** The muted state, plus muting with the M key while a component using this is on screen. */
export function useSoundControls(): { muted: boolean; toggleMuted: () => void } {
  const isMuted = useSyncExternalStore(
    subscribeToMute,
    () => muted,
    () => false, // The server can't know, so the first render assumes sound is on.
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyM' || event.repeat || event.metaKey || event.ctrlKey) return;
      if (!isTypingIn(event.target as HTMLElement | null)) toggleMuted();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { muted: isMuted, toggleMuted };
}

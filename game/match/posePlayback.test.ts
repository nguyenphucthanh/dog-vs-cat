import { describe, expect, it } from 'vitest';
import { createRng } from '../../shared/game/rng';
import { PosePlayback, type PoseSample } from './posePlayback';

const FRAME_MS = 1000 / 60;
const WALK = 5; // Blocks per second.

const sample = (sentAt: number, overrides: Partial<PoseSample> = {}): PoseSample => ({
  sentAt,
  x: 0,
  y: 40,
  z: 0,
  yaw: 0,
  pitch: 0,
  grounded: true,
  ...overrides,
});

/** Someone walking steadily, with poses sent every `intervalMs` and delayed by a varying amount. */
function walkOverNetwork(intervalMs: number, latencyMs: number, jitterMs: number, clockSkewMs = 0) {
  const rng = createRng(7);
  const arrivals = [];
  for (let sentAt = 0; sentAt < 20_000; sentAt += intervalMs) {
    arrivals.push({
      arrivesAt: sentAt + latencyMs + rng() * jitterMs,
      sample: sample(sentAt + clockSkewMs, { x: (sentAt / 1000) * WALK }),
    });
  }
  arrivals.sort((a, b) => a.arrivesAt - b.arrivesAt);

  const playback = new PosePlayback();
  const speeds: number[] = [];
  let lastX: number | null = null;
  let next = 0;
  for (let now = 0; now < 20_000; now += FRAME_MS) {
    while (next < arrivals.length && arrivals[next].arrivesAt <= now) {
      playback.push(arrivals[next].sample, now);
      next++;
    }
    const pose = playback.read(now);
    if (!pose) continue;
    if (lastX !== null && now > 5000) speeds.push(((pose.x - lastX) / FRAME_MS) * 1000);
    lastX = pose.x;
  }
  return speeds;
}

describe('PosePlayback', () => {
  it.each([
    ['same wifi, far server', 300, 150, 60, 0],
    ['bad jitter', 300, 300, 150, 0],
    ['fast connection', 200, 40, 20, 0],
    ['sender clock an hour ahead', 300, 150, 60, 3_600_000],
    ['sender clock an hour behind', 300, 150, 60, -3_600_000],
  ])('keeps walking speed even: %s', (_, interval, latency, jitter, skew) => {
    const speeds = walkOverNetwork(interval, latency, jitter, skew);
    expect(speeds.length).toBeGreaterThan(500);
    const stalled = speeds.filter((speed) => speed < WALK * 0.5).length;
    expect(stalled).toBe(0);
    for (const speed of speeds) expect(speed).toBeLessThan(WALK * 1.1);
  });

  it('holds the last pose instead of guessing when poses stop coming', () => {
    const playback = new PosePlayback();
    playback.push(sample(0, { x: 0 }), 100);
    playback.push(sample(300, { x: 1.5 }), 400);
    const pose = playback.read(5000)!;
    expect(pose.x).toBe(1.5);
    expect(pose.moving).toBe(false);
  });

  it('does not rush across a long pause in the poses', () => {
    const playback = new PosePlayback();
    playback.push(sample(0, { x: 0 }), 100);
    playback.push(sample(300, { x: 1.5 }), 400);
    playback.read(1000);
    playback.push(sample(6000, { x: 1.53 }), 6100);
    const pose = playback.read(6200)!;
    expect(pose.x).toBeGreaterThanOrEqual(1.5);
    expect(pose.x).toBeLessThanOrEqual(1.53);
    expect(pose.moving).toBe(false);
  });

  it('turns the short way round', () => {
    const playback = new PosePlayback();
    playback.push(sample(0, { yaw: 3 }), 0);
    playback.push(sample(300, { yaw: -3 }), 300);
    const { yaw } = playback.read(330 + 150)!; // Delay is 330, so this plays halfway between them.
    expect(Math.abs(yaw)).toBeGreaterThan(3);
  });

  it('ignores a repeated or older pose, even after being stopped', () => {
    const playback = new PosePlayback();
    playback.push(sample(100, { x: 1 }), 100);
    playback.push(sample(100, { x: 9 }), 110);
    playback.push(sample(50, { x: 9 }), 120);
    expect(playback.stop()!.x).toBe(1);
    playback.push(sample(100, { x: 9 }), 130);
    expect(playback.hasPose).toBe(false);
    expect(playback.read(140)).toBeNull();
    playback.push(sample(200, { x: 2 }), 150);
    expect(playback.read(150)!.x).toBe(2);
  });
});

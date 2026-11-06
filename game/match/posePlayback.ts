export type PoseSample = {
  sentAt: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
};

export type PlayedPose = Omit<PoseSample, 'sentAt'> & { moving: boolean };

const FIRST_GAP_MS = 300; // A guess at the spacing of poses, until two in a row have been seen.
const IDLE_GAP_MS = 1000; // Longer than this means the player stood still, not that the network was late.
const NEEDED_WINDOW = 8;
const MARGIN_MS = 30;
// Playback may run this much slower or faster than real time while the delay adjusts.
const SLOW_DOWN = 0.25;
const SPEED_UP = 0.05;
const MOVING_SPEED = 0.5; // Blocks per second, below which the legs stay still.

function shortestAngle(from: number, to: number): number {
  const difference = (to - from) % (Math.PI * 2);
  return ((difference + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
}

/**
 * Plays another player's poses back slightly in the past, on the sender's clock, so
 * movement stays even however unevenly the poses arrive.
 *
 * The delay only has to cover the time until the next pose turns up: how long a pose
 * took to get here, plus the spacing between poses. Sender and receiver clocks may
 * disagree, which only shifts that number and cancels out when it is subtracted again.
 */
export class PosePlayback {
  private samples: PoseSample[] = [];
  private newestSentAt = -Infinity;
  private needed: number[] = [];
  private delayMs: number | null = null;
  private lastReadAt: number | null = null;

  get hasPose(): boolean {
    return this.samples.length > 0;
  }

  /** `now` is this machine's clock. Repeats of a pose already seen are ignored. */
  push(sample: PoseSample, now: number): void {
    if (!(sample.sentAt > this.newestSentAt)) return;
    const gap = this.samples.length > 0 ? sample.sentAt - this.newestSentAt : FIRST_GAP_MS;
    this.newestSentAt = sample.sentAt;
    this.samples.push(sample);
    this.needed.push(now - sample.sentAt + (gap > IDLE_GAP_MS ? FIRST_GAP_MS : gap));
    if (this.needed.length > NEEDED_WINDOW) this.needed.shift();
    this.delayMs ??= this.targetDelay();
  }

  read(now: number): PlayedPose | null {
    if (this.delayMs === null) return null;
    const elapsed = this.lastReadAt === null ? 0 : now - this.lastReadAt;
    this.lastReadAt = now;
    const change = this.targetDelay() - this.delayMs;
    this.delayMs += Math.min(elapsed * SLOW_DOWN, Math.max(-elapsed * SPEED_UP, change));

    const playAt = now - this.delayMs;
    while (this.samples.length > 1 && this.samples[1].sentAt <= playAt) this.samples.shift();
    const [from, to] = this.samples;
    if (!to || playAt <= from.sentAt) return { ...from, moving: false };

    const span = to.sentAt - from.sentAt;
    const t = (playAt - from.sentAt) / span;
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t,
      yaw: from.yaw + shortestAngle(from.yaw, to.yaw) * t,
      pitch: from.pitch + (to.pitch - from.pitch) * t,
      grounded: from.grounded,
      moving: (Math.hypot(to.x - from.x, to.z - from.z) / span) * 1000 > MOVING_SPEED,
    };
  }

  /** Forgets everything still to play and returns the newest pose. A later repeat of a seen pose stays ignored. */
  stop(): PoseSample | null {
    const newest = this.samples.at(-1) ?? null;
    this.samples = [];
    this.needed = [];
    this.delayMs = null;
    this.lastReadAt = null;
    return newest;
  }

  private targetDelay(): number {
    return Math.max(...this.needed) + MARGIN_MS;
  }
}

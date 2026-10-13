/** Monotonic clock accounting: only explicit pauses are removed, not interruptions. */
export class Timeline {
  private accumulated = 0;
  private since: number | null = null;

  reset() { this.accumulated = 0; this.since = null; }
  resume(now: number) { if (this.since === null) this.since = now; }
  pause(now: number) {
    this.accumulated = this.elapsed(now);
    this.since = null;
  }
  elapsed(now: number): number {
    return this.accumulated + (this.since === null ? 0 : Math.max(0, now - this.since));
  }
}

export function dbToLevel(db: number | undefined): number {
  if (db === undefined || Number.isNaN(db) || db === -Infinity) return 0;
  return Math.min(1, Math.max(0, 10 ** (db / 20)));
}

/** Warn once per silent span; reset across pauses or unavailable metering. */
export class SilenceDetector {
  private since: number | null = null;
  private warned = false;
  constructor(private threshold = 0.001, private durationMs = 10_000) {}
  reset() { this.since = null; this.warned = false; }
  sample(level: number, now: number): number | null {
    if (!Number.isFinite(level) || level > this.threshold) { this.reset(); return null; }
    if (this.since === null) this.since = now;
    const duration = Math.max(0, now - this.since);
    if (!this.warned && duration >= this.durationMs) {
      this.warned = true;
      return duration;
    }
    return null;
  }
}

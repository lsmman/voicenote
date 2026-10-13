import { describe, expect, it } from '@jest/globals';
import { dbToLevel, SilenceDetector, Timeline } from '../timeline';

describe('Timeline', () => {
  it('excludes repeated pauses and is idempotent for duplicate commands', () => {
    const timeline = new Timeline();
    timeline.resume(1000); timeline.resume(2000);
    expect(timeline.elapsed(4000)).toBe(3000);
    timeline.pause(4000); timeline.pause(9000);
    expect(timeline.elapsed(20_000)).toBe(3000);
    timeline.resume(20_000);
    expect(timeline.elapsed(22_000)).toBe(5000);
    timeline.pause(22_000); timeline.resume(30_000);
    expect(timeline.elapsed(31_000)).toBe(6000);
    timeline.reset(); expect(timeline.elapsed(40_000)).toBe(0);
  });
  it('does not count negative clock deltas', () => {
    const timeline = new Timeline(); timeline.resume(100);
    expect(timeline.elapsed(50)).toBe(0);
  });
});

describe('dbToLevel', () => {
  it('maps amplitude dBFS to a clamped linear level', () => {
    expect(dbToLevel(0)).toBe(1);
    expect(dbToLevel(-20)).toBeCloseTo(0.1);
    expect(dbToLevel(-60)).toBeCloseTo(0.001);
    expect(dbToLevel(10)).toBe(1);
    expect(dbToLevel(-Infinity)).toBe(0);
    expect(dbToLevel(undefined)).toBe(0);
    expect(dbToLevel(NaN)).toBe(0);
  });
});

describe('SilenceDetector', () => {
  it('warns once at ten seconds and rearms after sound', () => {
    const detector = new SilenceDetector();
    expect(detector.sample(0, 0)).toBeNull();
    expect(detector.sample(0.001, 9999)).toBeNull();
    expect(detector.sample(0, 10_000)).toBe(10_000);
    expect(detector.sample(0, 20_000)).toBeNull();
    detector.sample(0.5, 21_000); detector.sample(0, 22_000);
    expect(detector.sample(0, 32_000)).toBe(10_000);
  });
  it('does not carry a silent span across pauses or invalid samples', () => {
    const detector = new SilenceDetector();
    detector.sample(0, 0); detector.reset();
    expect(detector.sample(0, 20_000)).toBeNull();
    detector.sample(NaN, 25_000);
    expect(detector.sample(0, 30_000)).toBeNull();
  });
});

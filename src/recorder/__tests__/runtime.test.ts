import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRecorder, type Capture, type Driver } from '../runtime';
import type { AudioChunk } from '../../core/types';
import type { RecorderWarning } from '../types';

function fixture() {
  const chunks: AudioChunk[] = [];
  const warnings: RecorderWarning[] = [];
  const order: string[] = [];
  let freeBytes = 2_000_000_000;
  let interrupted: string | undefined;
  let persist: () => Promise<void> = async () => {};
  let failures = 0;
  let captures = 0;
  const driver: Driver = {
    async open() {},
    async prepare(): Promise<Capture> {
      if (failures > 0) { failures--; throw new Error('Microphone busy'); }
      const id = captures++;
      let started = 0;
      order.push(`prepare-${id}`);
      return {
        start() { started = performance.now(); order.push(`start-${id}`); },
        sample() { const error = interrupted; interrupted = undefined; return { level: 0, interrupted: error }; },
        async stop() {
          order.push(`stop-${id}`);
          return {
            durationMs: performance.now() - started, mimeType: 'audio/mp4',
            async persist(noteId, seq) { await persist(); order.push(`persist-${id}`); return `${noteId}/${seq}`; },
            async discard() { order.push(`discard-${id}`); },
          };
        },
        async dispose() { order.push(`dispose-${id}`); },
      };
    },
    async awake(value) { order.push(`awake-${value}`); },
    async close() { order.push('close'); },
    freeBytes: () => freeBytes,
  };
  const recorder = createRecorder(driver);
  return { recorder, driver, chunks, warnings, order,
    start: () => recorder.start('note', { onChunk: chunk => chunks.push(chunk), onWarning: warning => warnings.push(warning) }),
    storage: (bytes: number) => { freeBytes = bytes; },
    interrupt: () => { interrupted = 'phone call'; },
    failStarts: (count: number) => { failures = count; },
    blockPersistence: (pending: Promise<void>) => { void pending.catch(() => {}); persist = () => pending; },
  };
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('recorder lifecycle', () => {
  it('rotates independent chunks and starts capture before persisting the prior file', async () => {
    const f = fixture(); await f.start();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(f.chunks).toEqual([expect.objectContaining({ seq: 0, startMs: 0, durationMs: 30_000, localPath: 'note/0' })]);
    expect(f.order.indexOf('start-1')).toBeLessThan(f.order.indexOf('persist-0'));
    await jest.advanceTimersByTimeAsync(1000); await f.recorder.stop();
    expect(f.chunks[1]).toMatchObject({ seq: 1, startMs: 30_000, durationMs: 1000 });
    expect(f.recorder.getState()).toBe('idle');
    expect(jest.getTimerCount()).toBe(0);
  });
  it('flushes pause, excludes paused time, skips a sub-500ms chunk without consuming seq', async () => {
    const f = fixture(); await f.start();
    await jest.advanceTimersByTimeAsync(400); await f.recorder.pause();
    expect(f.chunks).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(90_000); await f.recorder.resume();
    await jest.advanceTimersByTimeAsync(600); await f.recorder.pause();
    expect(f.chunks[0]).toMatchObject({ seq: 0, startMs: 400, durationMs: 600 });
    await f.recorder.resume(); await jest.advanceTimersByTimeAsync(500); await f.recorder.stop();
    expect(f.chunks[1]).toMatchObject({ seq: 1, startMs: 1000, durationMs: 500 });
  });
  it('serializes stop behind durable persistence and never emits early', async () => {
    const f = fixture(); await f.start();
    let release!: () => void;
    f.blockPersistence(new Promise<void>(resolve => { release = resolve; }));
    await jest.advanceTimersByTimeAsync(30_000);
    expect(f.chunks).toHaveLength(0);
    const stop = f.recorder.stop();
    release(); await stop;
    expect(f.chunks).toHaveLength(1);
    expect(f.recorder.getState()).toBe('idle');
  });
  it('warns for low storage, then safely flushes and stops at 200MB', async () => {
    const f = fixture(); f.storage(900_000_000); await f.start();
    expect(f.warnings).toContainEqual({ kind: 'low-storage', freeBytes: 900_000_000 });
    await jest.advanceTimersByTimeAsync(1000); f.storage(199_000_000);
    await jest.advanceTimersByTimeAsync(5000);
    expect(f.recorder.getState()).toBe('idle');
    expect(f.chunks).toHaveLength(1);
    expect(f.order).toContain('awake-false');
  });
  it('rejects critically low storage before opening and rejects duplicate start', async () => {
    const f = fixture(); f.storage(1);
    await expect(f.start()).rejects.toThrow('Insufficient storage');
    f.storage(2_000_000_000); await f.start();
    await expect(f.start()).rejects.toThrow('already active');
    await f.recorder.stop();
  });
  it('restarts an interrupted chunk and retries a busy microphone without losing the previous chunk', async () => {
    const f = fixture(); await f.start();
    await jest.advanceTimersByTimeAsync(1000); f.interrupt(); f.failStarts(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(f.chunks).toHaveLength(1);
    expect(f.warnings).toContainEqual({ kind: 'interrupted', reason: 'phone call' });
    await jest.advanceTimersByTimeAsync(2000);
    expect(f.order).toContain('start-1');
    await f.recorder.stop();
    expect(f.chunks).toHaveLength(2);
  });
  it('ends safely after a persistence error without claiming that chunk is durable', async () => {
    const f = fixture(); await f.start();
    f.blockPersistence(Promise.resolve().then(() => { throw new Error('disk write failed'); }));
    // Attach a handler until the recorder consumes the rejected promise.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(f.chunks).toHaveLength(0);
    expect(f.recorder.getState()).toBe('idle');
    expect(f.order).toContain('close');
  });
  it('tries pre-preparation before stopping the active recorder', async () => {
    const f = fixture(); f.driver.prepareAhead = f.driver.prepare;
    await f.start(); await jest.advanceTimersByTimeAsync(30_000);
    expect(f.order.indexOf('prepare-1')).toBeLessThan(f.order.indexOf('stop-0'));
    await f.recorder.stop();
  });
});

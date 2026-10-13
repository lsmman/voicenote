import { CHUNK_MS } from '../core/types';
import type { Recorder, RecorderEvents, RecorderState, RecorderWarning } from './types';
import { SilenceDetector, Timeline } from './timeline';

export interface CapturedAudio {
  durationMs: number;
  mimeType: string;
  persist(noteId: string, seq: number): Promise<string>;
  discard(): Promise<void>;
}
export interface Capture {
  start(): void;
  sample(): { level?: number; interrupted?: string };
  stop(): Promise<CapturedAudio>;
  dispose(): Promise<void>;
}
export interface Driver {
  open(warn: (warning: RecorderWarning) => void): Promise<void>;
  prepare(): Promise<Capture>;
  prepareAhead?(): Promise<Capture | null>;
  awake(active: boolean): Promise<void>;
  close(): Promise<void>;
  freeBytes?(): number;
}
const now = () => performance.now();
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Serializes UI commands, rotations and recovery; timer ticks never queue up. */
export function createRecorder(driver: Driver): Recorder {
  let state: RecorderState = 'idle';
  let events: Partial<RecorderEvents> = {};
  let noteId = '';
  let seq = 0;
  let active: Capture | null = null;
  let chunkStart = 0;
  let chunkClock = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let tail: Promise<void> = Promise.resolve();
  let queued = 0;
  let nextRetry = 0;
  let nextStorage = 0;
  let storageWarned = false;
  const timeline = new Timeline();
  const silence = new SilenceDetector();

  // A UI callback must not break resource cleanup or make a durable chunk get reused.
  function emit<K extends keyof RecorderEvents>(key: K, value: Parameters<RecorderEvents[K]>[0]) {
    try { (events[key] as ((arg: typeof value) => void) | undefined)?.(value); }
    catch (error) { console.error('Recorder event callback failed', error); }
  }
  const warn = (warning: RecorderWarning) => emit('onWarning', warning);
  const change = (next: RecorderState) => { state = next; emit('onStateChange', next); };
  function enqueue(operation: () => Promise<void>): Promise<void> {
    queued++;
    const result = tail.then(operation).finally(() => { queued--; });
    tail = result.catch(() => {});
    return result;
  }
  async function wake(value: boolean) {
    try { await driver.awake(value); }
    catch (error) { warn({ kind: 'interrupted', reason: `Screen wake lock: ${reason(error)}` }); }
  }
  function storageSafe(): boolean {
    const bytes = driver.freeBytes?.();
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return true;
    if (bytes < 1_000_000_000 && (!storageWarned || bytes < 200_000_000)) {
      warn({ kind: 'low-storage', freeBytes: bytes });
      storageWarned = true;
    } else if (bytes >= 1_000_000_000) storageWarned = false;
    return bytes >= 200_000_000;
  }
  async function begin(prepared?: Capture | null) {
    const capture = prepared ?? await driver.prepare();
    try { capture.start(); }
    catch (error) { await capture.dispose(); throw error; }
    active = capture;
    chunkClock = now();
    chunkStart = timeline.elapsed(chunkClock);
  }
  async function finish(restart: boolean, recovering = false) {
    const previous = active;
    const startMs = chunkStart;
    // Preparation overlap is opportunistic. A rejected second native instance falls
    // back to sequential stop/prepare/start for the rest of this session.
    let prepared: Capture | null = restart && !recovering && driver.prepareAhead
      ? await driver.prepareAhead() : null;
    active = null;
    const stoppedAt = now();
    let audio: CapturedAudio | undefined;
    let startError: unknown;
    try {
      if (previous) audio = await previous.stop();
      if (restart) {
        try { await begin(prepared); prepared = null; }
        catch (error) { startError = error; }
        const gapMs = Math.max(0, now() - stoppedAt);
        if (gapMs >= 1) warn({ kind: 'interrupted', reason: `Chunk rotation capture gap: ${Math.round(gapMs)}ms (stop/start wall time)` });
      }
      if (audio) {
        if (audio.durationMs >= 500) {
          const localPath = await audio.persist(noteId, seq);
          emit('onChunk', { noteId, seq: seq++, startMs, durationMs: audio.durationMs,
            localPath, mimeType: audio.mimeType, remotePath: null, uploadedAt: null, transcribedAt: null });
        } else await audio.discard();
      }
      if (startError) {
        warn({ kind: 'interrupted', reason: `Restart pending: ${reason(startError)}` });
        nextRetry = now() + 1000;
      }
    } finally {
      await previous?.dispose();
      await prepared?.dispose();
    }
  }
  async function cleanup() {
    if (timer) clearInterval(timer);
    timer = undefined;
    try { await active?.dispose(); }
    finally {
      active = null;
      try { await driver.close(); }
      finally { await wake(false); change('idle'); emit('onLevel', 0); }
    }
  }
  async function stop() {
    if (state === 'idle') return;
    change('stopping');
    timeline.pause(now());
    try { await finish(false); }
    finally { emit('onElapsed', timeline.elapsed(now())); await cleanup(); }
  }
  async function tick() {
    if (state !== 'recording') return;
    const time = now();
    emit('onElapsed', timeline.elapsed(time));
    if (time >= nextStorage) {
      nextStorage = time + 5000;
      if (!storageSafe()) { await stop(); return; }
    }
    if (!active) {
      if (time >= nextRetry) {
        nextRetry = time + 1000;
        try { await begin(); }
        catch (error) { warn({ kind: 'interrupted', reason: `Restart pending: ${reason(error)}` }); }
      }
      return;
    }
    const sample = active.sample();
    emit('onLevel', sample.level ?? 0);
    if (sample.interrupted) {
      warn({ kind: 'interrupted', reason: sample.interrupted });
      silence.reset();
      await finish(true, true);
    } else {
      if (sample.level === undefined) silence.reset();
      else {
        const forMs = silence.sample(sample.level, time);
        if (forMs !== null) warn({ kind: 'silence', forMs });
      }
      if (time - chunkClock >= CHUNK_MS) await finish(true);
    }
  }
  return {
    getState: () => state,
    start: (id, callbacks) => enqueue(async () => {
      if (state !== 'idle') throw new Error('Recorder is already active');
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid note ID');
      events = callbacks; noteId = id; seq = 0;
      timeline.reset(); silence.reset(); storageWarned = false; nextStorage = 0; nextRetry = 0;
      try {
        if (!storageSafe()) throw new Error('Insufficient storage to record');
        await driver.open(warn);
        await begin();
        timeline.resume(chunkClock); chunkStart = 0;
        change('recording');
        await wake(true);
        emit('onElapsed', 0);
        timer = setInterval(() => {
          if (queued || state !== 'recording') return;
          void enqueue(async () => {
            try { await tick(); }
            catch (error) {
              warn({ kind: 'interrupted', reason: reason(error) });
              // Keep failure cleanup in this same queued operation so it cannot
              // accidentally close a subsequent start() requested by the UI.
              timeline.pause(now());
              change('stopping');
              emit('onElapsed', timeline.elapsed(now()));
              // Do not reuse the failed chunk's sequence/key for a later file.
              await cleanup();
            }
          }).catch(error => warn({ kind: 'interrupted', reason: `Recorder cleanup: ${reason(error)}` }));
        }, 100);
      } catch (error) { await cleanup(); throw error; }
    }),
    pause: () => enqueue(async () => {
      if (state !== 'recording') return;
      timeline.pause(now()); silence.reset(); change('paused');
      try { await finish(false); }
      catch (error) { await cleanup(); throw error; }
      finally { emit('onElapsed', timeline.elapsed(now())); emit('onLevel', 0); await wake(false); }
    }),
    resume: () => enqueue(async () => {
      if (state !== 'paused') return;
      if (!storageSafe()) { await stop(); return; }
      await begin();
      timeline.resume(chunkClock);
      silence.reset(); change('recording'); await wake(true);
    }),
    stop: () => enqueue(stop),
  };
}

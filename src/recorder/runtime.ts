import { CHUNK_MS, type AudioChunk } from '../core/types';
import type { Recorder, RecorderEvents, RecorderState, RecorderWarning } from './types';
import { SilenceDetector } from './timeline';

export interface CapturedAudio {
  durationMs: number;
  mimeType: string;
  persist(noteId: string, seq: number): Promise<string>;
  discard(): Promise<void>;
}
export interface Capture {
  start(): void;
  sample(): { level?: number; durationMs?: number; interrupted?: string };
  stop(): Promise<CapturedAudio>;
  salvage?(): CapturedAudio;
  dispose(): Promise<void>;
}
export interface Driver {
  open(warn: (warning: RecorderWarning) => void): Promise<void>;
  prepare(): Promise<Capture>;
  prepareAhead?(): Promise<Capture | null>;
  subscribe?(tick: () => void): () => void;
  awake(active: boolean): Promise<void>;
  close(): Promise<void>;
  freeBytes?(): number;
}
export const OPERATION_TIMEOUT_MS = 10_000;
export async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after 10000ms`)), OPERATION_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
export interface RecorderDiagnostics {
  rotationGapMs: number;
  pendingPersists: number;
  error: string | null;
}
export type ReliableRecorder = Recorder & { getDiagnostics(): RecorderDiagnostics };
type Pending = { audio: CapturedAudio; chunk: AudioChunk & { mayOverlap: boolean }; attempts: number;
  due: number; busy: boolean; done?: Promise<void>; deliver: (chunk: AudioChunk) => void; warning: () => void };

/** Capture time is authoritative. Storage work never occupies the command queue. */
export function createRecorder(driver: Driver): ReliableRecorder {
  let state: RecorderState = 'idle';
  let events: Partial<RecorderEvents> = {};
  let noteId = '', seq = 0, total = 0, observed = 0, startedAt = 0;
  let active: Capture | null = null;
  let mayOverlap = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;
  let tail = Promise.resolve(), queued = 0;
  let nextRetry = 0, nextStorage = 0, retrySince: number | null = null, attempts = 0;
  let storageWarned = false, ended = false;
  let gapSince: number | null = null;
  let rotationGapMs = 0, errorState: string | null = null;
  const pending: Pending[] = [];
  const silence = new SilenceDetector();
  function emit<K extends keyof RecorderEvents>(key: K, value: Parameters<RecorderEvents[K]>[0]) {
    try { (events[key] as ((arg: typeof value) => void) | undefined)?.(value); }
    catch (error) { console.error('Recorder event callback failed', error); }
  }
  const warn = (warning: RecorderWarning) => emit('onWarning', warning);
  const change = (next: RecorderState) => { state = next; emit('onStateChange', next); };
  function enqueue(operation: () => Promise<void>) {
    queued++;
    const result = tail.then(operation).finally(() => { queued--; });
    tail = result.catch(() => {});
    return result;
  }
  async function dispose(capture: Capture | null) {
    if (!capture) return;
    try { await bounded(capture.dispose(), 'dispose'); } catch (error) { warn({ kind: 'interrupted', reason: String(error) }); }
  }
  function schedulePersistence() {
    clearTimeout(retryTimer);
    const due = pending.filter(p => !p.busy && p.attempts < 4).map(p => p.due);
    if (due.length) retryTimer = setTimeout(() => { pumpPersistence(); }, Math.max(0, Math.min(...due) - Date.now()));
  }
  function pumpPersistence() {
    for (const p of pending) {
      if (p.busy || p.attempts >= 4 || p.due > Date.now()) continue;
      p.busy = true; p.attempts++;
      let write: Promise<string>;
      try { write = p.audio.persist(p.chunk.noteId, p.chunk.seq); }
      catch (error) { write = Promise.reject(error); }
      p.done = bounded(write, 'persist').then(localPath => {
        pending.splice(pending.indexOf(p), 1);
        try { p.deliver({ ...p.chunk, localPath }); } catch (error) { console.error(error); }
      }, () => {
        p.due = Date.now() + 1000 * 2 ** (p.attempts - 1);
        if (p.attempts === 4) p.warning(); // Retain failed audio for diagnostics/recovery; never discard it.
      }).finally(() => { p.busy = false; schedulePersistence(); });
    }
    schedulePersistence();
  }
  function retain(audio: CapturedAudio, overlap: boolean, fallbackDuration: number) {
    const durationMs = Number.isFinite(audio.durationMs) && audio.durationMs >= 0 ? audio.durationMs : fallbackDuration;
    if (durationMs < 500) { void audio.discard().catch(console.error); return; }
    const callbacks = events;
    const chunk = { noteId, seq: seq++, startMs: total, durationMs, mayOverlap: overlap,
      localPath: null, mimeType: audio.mimeType, remotePath: null, uploadedAt: null, transcribedAt: null };
    total += durationMs;
    pending.push({ audio, chunk, attempts: 0, due: Date.now(), busy: false,
      deliver: chunk => callbacks.onChunk?.(chunk),
      warning: () => { try { callbacks.onWarning?.({ kind: 'interrupted', reason: 'persist-failed' }); } catch (error) { console.error(error); } } });
    pumpPersistence();
  }
  async function prepare(ahead = false) {
    let expired = false;
    const request = ahead ? driver.prepareAhead!() : driver.prepare();
    // A late prepare must never resurrect a timed-out session.
    void request.then(capture => { if (expired) void dispose(capture); }, () => {});
    try { return await bounded(request, 'prepare'); }
    catch (error) { expired = true; throw error; }
  }
  function startCapture(capture: Capture) {
    capture.start(); active = capture; observed = 0; startedAt = Date.now();
    if (gapSince !== null) { rotationGapMs += Math.max(0, startedAt - gapSince); gapSince = null; }
  }
  async function begin() {
    const capture = await prepare();
    if (!capture) throw new Error('No capture');
    try { startCapture(capture); } catch (error) { await dispose(capture); throw error; }
  }
  function storageSafe() {
    const bytes = driver.freeBytes?.();
    if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return true;
    if (bytes < 1_000_000_000 && (!storageWarned || bytes < 200_000_000)) {
      warn({ kind: 'low-storage', freeBytes: bytes }); storageWarned = true;
    } else if (bytes >= 1_000_000_000) storageWarned = false;
    return bytes >= 200_000_000;
  }
  function retryFailed(error: unknown) {
    retrySince ??= Date.now(); attempts++; nextRetry = Date.now() + 1000;
    errorState = String(error);
    if (errorState.includes('timed out')) warn({ kind: 'interrupted', reason: errorState });
  }
  async function finish(restart: boolean, recovering = false) {
    const previous = active, previousObserved = observed, previousOverlap = mayOverlap;
    let prepared: Capture | null = null;
    if (restart && !recovering && driver.prepareAhead) {
      try { prepared = await prepare(true); }
      catch (error) { if (String(error).includes('timed out')) warn({ kind: 'interrupted', reason: String(error) }); }
    }
    active = null;
    let overlap = false;
    if (prepared) {
      try { startCapture(prepared); overlap = true; mayOverlap = true; }
      catch { await dispose(prepared); }
    }
    if (restart && !active) gapSince ??= Date.now();
    let audio: CapturedAudio | undefined;
    if (previous) {
      try { audio = await bounded(previous.stop(), 'stop'); }
      catch (error) {
        warn({ kind: 'interrupted', reason: `${String(error)}; last observed duration ${previousObserved}ms` });
        audio = previous.salvage?.();
        errorState = String(error);
      }
    }
    if (!active) observed = 0;
    if (restart && !active && attempts < 30 && (retrySince === null || Date.now() - retrySince < 60_000)) {
      try { await begin(); mayOverlap = false; }
      catch (error) { retryFailed(error); }
    }
    if (audio) retain(audio, previousOverlap || overlap, previousObserved);
    await dispose(previous);
    emit('onElapsed', total + (active ? observed : 0));
  }
  async function wake(value: boolean) {
    try { await bounded(driver.awake(value), 'wake'); } catch (error) { console.debug('Recorder wake lock', error); }
  }
  async function cleanup() {
    clearInterval(timer); timer = undefined; unsubscribe?.(); unsubscribe = undefined;
    await dispose(active); active = null;
    try { await bounded(driver.close(), 'close'); }
    catch (error) { console.debug('Recorder close', error); }
    await wake(false); change('idle'); emit('onLevel', 0);
  }
  async function stop() {
    if (state === 'idle') return;
    change('stopping');
    try { await finish(false); await Promise.all(pending.filter(p => p.busy).map(p => p.done)); }
    finally { await cleanup(); }
  }
  async function fatal(error: unknown) {
    errorState = String(error);
    warn({ kind: 'interrupted', reason: errorState });
    // Always attempt stop + persistence before releasing the in-flight capture.
    await stop();
  }
  async function tick() {
    if (state !== 'recording') return;
    const time = Date.now();
    if (ended) { await stop(); return; }
    if (time >= nextStorage) {
      nextStorage = time + 5000;
      if (!storageSafe()) { await stop(); return; }
    }
    if (!active) {
      if (attempts >= 30 || (retrySince !== null && time - retrySince >= 60_000)) {
        errorState = 'Microphone restart limit exceeded'; warn({ kind: 'mic-ended' }); await stop(); return;
      }
      if (time >= nextRetry) {
        try { await begin(); } catch (error) { retryFailed(error); }
      }
      return;
    }
    const sample = active.sample();
    observed = sample.durationMs !== undefined && Number.isFinite(sample.durationMs)
      ? Math.max(0, sample.durationMs) : Math.max(0, time - startedAt);
    emit('onElapsed', total + observed); emit('onLevel', sample.level ?? 0);
    if (sample.interrupted) {
      retrySince ??= time;
      if (++attempts >= 30 || time - retrySince >= 60_000) {
        errorState = 'Microphone restart limit exceeded'; warn({ kind: 'mic-ended' }); await stop(); return;
      }
      warn({ kind: 'interrupted', reason: sample.interrupted }); silence.reset(); await finish(true, true);
    } else {
      // Only sustained healthy capture resets the recovery budget.
      if (observed >= 5000) { attempts = 0; retrySince = null; errorState = null; }
      if (sample.level === undefined) silence.reset();
      else { const forMs = silence.sample(sample.level, time); if (forMs !== null) warn({ kind: 'silence', forMs }); }
      if (observed >= CHUNK_MS) await finish(true);
    }
  }
  function requestTick() {
    if (queued || state !== 'recording') return;
    void enqueue(async () => { try { await tick(); } catch (error) { await fatal(error); } }).catch(console.error);
  }
  return {
    getState: () => state,
    getDiagnostics: () => ({ rotationGapMs, pendingPersists: pending.length, error: errorState }),
    start: (id, callbacks) => enqueue(async () => {
      if (state !== 'idle') throw new Error('Recorder is already active');
      if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid note ID');
      if (pending.some(p => p.chunk.noteId === id)) throw new Error('Note has pending audio persistence');
      events = callbacks; noteId = id; seq = 0; total = 0; observed = 0; ended = false; mayOverlap = false;
      errorState = null; rotationGapMs = 0; gapSince = null; attempts = 0; retrySince = null; nextRetry = 0; nextStorage = 0;
      silence.reset(); storageWarned = false;
      try {
        if (!storageSafe()) throw new Error('Insufficient storage to record');
        await bounded(driver.open(warning => {
          warn(warning);
          if (warning.kind === 'mic-ended') {
            ended = true;
            void enqueue(stop).catch(console.error);
          }
        }), 'open');
        await begin(); change('recording'); await wake(true); emit('onElapsed', 0);
        unsubscribe = driver.subscribe?.(requestTick);
        timer = setInterval(requestTick, 100);
      } catch (error) {
        errorState = String(error);
        if (errorState.includes('timed out')) warn({ kind: 'interrupted', reason: errorState });
        if (active) { change('stopping'); await finish(false); }
        await cleanup(); throw error;
      }
    }),
    pause: () => enqueue(async () => {
      if (state !== 'recording') return;
      change('paused'); silence.reset();
      try { await finish(false); } catch (error) { await fatal(error); throw error; }
      emit('onLevel', 0); await wake(false);
    }),
    resume: () => enqueue(async () => {
      if (state !== 'paused') return;
      if (ended || !storageSafe()) { await stop(); return; }
      try { await begin(); mayOverlap = false; silence.reset(); change('recording'); await wake(true); }
      catch (error) { await fatal(error); throw error; }
    }),
    stop: () => enqueue(stop),
  };
}

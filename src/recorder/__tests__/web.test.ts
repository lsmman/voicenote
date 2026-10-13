import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AudioChunk } from '../../core/types';
import type { Recorder } from '../types';

const mockPutAudioBlob = jest.fn<(key: string, blob: Blob) => Promise<void>>();
jest.mock('../../store', () => ({ store: { putAudioBlob: (key: string, blob: Blob) => mockPutAudioBlob(key, blob) } }), { virtual: true });
// jest-expo prefers .native; explicitly exercise the browser implementation.
const { recorder } = require('../index.ts') as { recorder: Recorder };

class Track extends EventTarget {
  readyState = 'live';
  stop = jest.fn(() => { this.readyState = 'ended'; });
}
let emptyBlob = false;
let hangStop = false;
let decodedDuration: number | undefined;
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported(type: string) { return type === 'audio/webm;codecs=opus'; }
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice = 0;
  constructor() { FakeMediaRecorder.instances.push(this); }
  start(timeslice: number) { this.timeslice = timeslice; this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    if (hangStop) return;
    // Model asynchronous final data delivery, including after state becomes inactive.
    Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(emptyBlob ? [] : ['independent-file'], { type: this.mimeType }) });
      this.onstop?.();
    });
  }
}
const mockDisconnect = jest.fn();
class FakeAudioContext {
  state = 'running';
  get currentTime() { return performance.now() / 1000; }
  async decodeAudioData() { if (decodedDuration === undefined) throw Error('codec unavailable'); return { duration: decodedDuration }; }
  async resume() {}
  async close() { this.state = 'closed'; }
  createMediaStreamSource() { return { connect() {}, disconnect: mockDisconnect }; }
  createAnalyser() {
    return { fftSize: 2048, getFloatTimeDomainData: (buffer: Float32Array) => buffer.fill(0.2), disconnect: mockDisconnect };
  }
}
let track: Track;
let lock: EventTarget & { release: ReturnType<typeof jest.fn<() => Promise<void>>> };
let documentTarget: EventTarget & { visibilityState: string };
let requestWake: ReturnType<typeof jest.fn<() => Promise<typeof lock>>>;
const originals = new Map<string, PropertyDescriptor | undefined>();
function globalValue(key: string, value: unknown) {
  if (!originals.has(key)) originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
beforeEach(() => {
  jest.useFakeTimers();
  FakeMediaRecorder.instances = []; emptyBlob = false; hangStop = false; decodedDuration = undefined;
  mockPutAudioBlob.mockReset().mockResolvedValue(undefined);
  track = new Track();
  lock = Object.assign(new EventTarget(), { release: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) });
  requestWake = jest.fn<() => Promise<typeof lock>>().mockResolvedValue(lock);
  documentTarget = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalValue('document', documentTarget);
  globalValue('navigator', { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) }, wakeLock: { request: requestWake } });
  globalValue('MediaRecorder', FakeMediaRecorder);
  globalValue('AudioContext', FakeAudioContext);
});
afterEach(async () => {
  await recorder.stop();
  jest.useRealTimers();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  originals.clear();
});

describe('web recorder', () => {
  it('uses 5s slices and a new MediaRecorder for each independently stored chunk', async () => {
    const chunks: AudioChunk[] = [];
    await recorder.start('web-note', { onChunk: chunk => chunks.push(chunk) });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[0].timeslice).toBe(5000);
    expect(mockPutAudioBlob).toHaveBeenCalledWith('web-note/0', expect.any(Blob));
    expect(chunks[0]).toMatchObject({ localPath: 'web-note/0', mimeType: 'audio/webm;codecs=opus', durationMs: 30_000 });
    await jest.advanceTimersByTimeAsync(1000); await recorder.stop();
    expect(chunks).toHaveLength(2);
    expect(track.stop).toHaveBeenCalled();
    expect(lock.release).toHaveBeenCalled();
  });
  it('waits for IndexedDB commit before delivering onChunk', async () => {
    let commit!: () => void;
    mockPutAudioBlob.mockImplementation(() => new Promise<void>(resolve => { commit = resolve; }));
    const onChunk = jest.fn();
    await recorder.start('note', { onChunk });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(onChunk).not.toHaveBeenCalled();
    const stopped = recorder.stop(); commit(); await stopped;
    expect(onChunk).toHaveBeenCalledTimes(1);
  });
  it('warns on ended/muted tracks and re-acquires a released wake lock on visibility', async () => {
    const onWarning = jest.fn();
    await recorder.start('note', { onWarning });
    track.dispatchEvent(new Event('mute'));
    track.dispatchEvent(new Event('ended'));
    expect(onWarning).toHaveBeenCalledWith({ kind: 'mic-ended' });
    expect(onWarning).toHaveBeenCalledWith({ kind: 'interrupted', reason: 'Microphone track muted' });
    lock.dispatchEvent(new Event('release'));
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(requestWake).toHaveBeenCalledTimes(2);
  });
  it('collects final data from an automatic stop even when state is already inactive', async () => {
    const onChunk = jest.fn(); await recorder.start('note', { onChunk });
    await jest.advanceTimersByTimeAsync(600);
    FakeMediaRecorder.instances[0].stop();
    await recorder.stop();
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(mockPutAudioBlob).toHaveBeenCalledTimes(1);
  });
});

it('uses decoded blob duration rather than wall time, and web paths stay IndexedDB keys', async () => {
  decodedDuration = 0.75;
  const onChunk = jest.fn(); await recorder.start('duration', { onChunk });
  await jest.advanceTimersByTimeAsync(1000); await recorder.stop();
  expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 750, localPath: 'duration/0' }));
  const { resolveLocalPath } = require('../paths.ts');
  expect(resolveLocalPath('duration/0')).toBe('duration/0');
});
it('flushes and closes on track ended with no restart loop', async () => {
  const onChunk = jest.fn(); await recorder.start('ended', { onChunk });
  await jest.advanceTimersByTimeAsync(1000);
  track.readyState = 'ended'; track.dispatchEvent(new Event('ended'));
  await jest.advanceTimersByTimeAsync(1);
  expect(recorder.getState()).toBe('idle'); expect(onChunk).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(120_000); expect(FakeMediaRecorder.instances).toHaveLength(1);
});
it('retries IndexedDB failure while the next MediaRecorder continues', async () => {
  mockPutAudioBlob.mockRejectedValueOnce(Error('transaction failed'));
  const onChunk = jest.fn(), onWarning = jest.fn(); await recorder.start('retry', { onChunk, onWarning });
  await jest.advanceTimersByTimeAsync(30_000);
  expect(FakeMediaRecorder.instances[1].state).toBe('recording');
  expect(onChunk).not.toHaveBeenCalled(); expect(onWarning).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000); expect(onChunk).toHaveBeenCalledTimes(1);
});
it('queues empty blobs and warns persist-failed only when retries exhaust', async () => {
  emptyBlob = true;
  const onWarning = jest.fn(); await recorder.start('empty', { onWarning });
  await jest.advanceTimersByTimeAsync(30_000);
  expect(recorder.getState()).toBe('recording'); expect(onWarning).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(7000);
  expect(onWarning).toHaveBeenCalledWith({ kind: 'interrupted', reason: 'persist-failed' });
  emptyBlob = false; await recorder.stop();
});
it('web stop timeout salvages already delivered slices and frees the command queue', async () => {
  const onChunk = jest.fn(), onWarning = jest.fn(); await recorder.start('timeout', { onChunk, onWarning });
  await jest.advanceTimersByTimeAsync(1000);
  FakeMediaRecorder.instances[0].ondataavailable?.({ data: new Blob(['saved-slice']) });
  hangStop = true; const stopping = recorder.stop();
  await jest.advanceTimersByTimeAsync(10_000); await stopping;
  expect(onChunk).toHaveBeenCalledTimes(1);
  expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('timed out') }));
  expect(recorder.getState()).toBe('idle'); hangStop = false;
});

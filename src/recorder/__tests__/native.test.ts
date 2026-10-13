import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AudioChunk } from '../../core/types';

const mockFiles = new Set<string>();
const mockMove = jest.fn<(destination: { uri: string }) => Promise<void>>();
const mockMode = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockActivate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDeactivate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
let mockFailOverlap = false;
let mockFail16k = false;
let mockDuration: number | undefined;
let mockHangStop = false;
let mockHangPrepare = false;
let mockHangMetadata = false;
class MockNativeRecorder {
  static instances: MockNativeRecorder[] = [];
  uri: string;
  recording = false;
  startedAt = 0;
  released = false;
  config: unknown;
  listener: ((status: { hasError: boolean; error: string; url: string; mediaServicesDidReset?: boolean }) => void) | undefined;
  constructor() {
    this.uri = `file:///documents/raw-${MockNativeRecorder.instances.length}.m4a`;
    MockNativeRecorder.instances.push(this);
  }
  addListener(_event: string, listener: typeof this.listener) { this.listener = listener; return { remove: () => { this.listener = undefined; } }; }
  async prepareToRecordAsync(config: { sampleRate: number }) {
    if (mockHangPrepare) await new Promise(() => {});
    if (mockFail16k && config.sampleRate === 16_000) throw new Error('Unsupported sample rate');
    if (mockFailOverlap && MockNativeRecorder.instances.some(item => item.recording)) throw new Error('Microphone busy');
    this.config = config;
  }
  record() { this.recording = true; this.startedAt = performance.now(); mockFiles.add(this.uri); }
  getStatus() {
    return { isRecording: this.recording, canRecord: true, durationMillis: this.recording ? performance.now() - this.startedAt : 0,
      metering: -20, url: this.uri, mediaServicesDidReset: false };
  }
  async stop() { this.recording = false; if (mockHangStop) await new Promise(() => {}); }
  release() { this.released = true; }
}
jest.mock('expo-audio', () => ({
  AudioModule: { AudioRecorder: MockNativeRecorder, requestNotificationPermissionsAsync: async () => ({ granted: true }) },
  AudioQuality: { MEDIUM: 64 }, IOSOutputFormat: { MPEG4AAC: 'aac ' },
  requestRecordingPermissionsAsync: async () => ({ granted: true }), setAudioModeAsync: () => mockMode(),
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: () => mockActivate(), deactivateKeepAwake: () => mockDeactivate() }));
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(...paths: (string | { uri: string })[]) { this.uri = paths.map(path => typeof path === 'string' ? path : path.uri).join('/'); }
    create() {}
  }
  class File extends Directory {
    async arrayBuffer() {
      if (mockHangMetadata) await new Promise(() => {});
      if (mockDuration === undefined) throw Error('metadata unavailable');
      const buffer = new ArrayBuffer(28); const view = new DataView(buffer);
      view.setUint32(0, 28); new Uint8Array(buffer, 4, 4).set([109, 118, 104, 100]);
      view.setUint32(20, 1000); view.setUint32(24, mockDuration); return buffer;
    }
    get exists() { return mockFiles.has(this.uri); }
    async move(destination: { uri: string }) { await mockMove(destination); mockFiles.delete(this.uri); mockFiles.add(destination.uri); }
    delete() { mockFiles.delete(this.uri); }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' }, availableDiskSpace: 2_000_000_000 } };
});
// Require after mock classes initialize; imports are hoisted by Babel.
const { recorder } = require('../index.native') as typeof import('../index.native');
beforeEach(() => {
  require('react-native').AppState.addEventListener.mockImplementation(() => ({ remove: jest.fn() }));
  jest.useFakeTimers(); MockNativeRecorder.instances = []; mockFiles.clear();
  mockMove.mockReset().mockResolvedValue(undefined); mockFailOverlap = false; mockFail16k = false;
  mockDuration = undefined; mockHangStop = false; mockHangPrepare = false; mockHangMetadata = false;
  mockActivate.mockClear(); mockDeactivate.mockClear();
});
afterEach(async () => { await recorder.stop(); jest.useRealTimers(); });

describe('native recorder', () => {
  it('captures mono AAC, keeps duration from before stop, and waits for the file move', async () => {
    const chunks: AudioChunk[] = [];
    await recorder.start('native-note', { onChunk: chunk => chunks.push(chunk) });
    expect(MockNativeRecorder.instances[0].config).toMatchObject({ sampleRate: 16_000, numberOfChannels: 1, bitRate: 48_000, isMeteringEnabled: true });
    await jest.advanceTimersByTimeAsync(1000);
    let moved!: () => void;
    mockMove.mockImplementationOnce(() => new Promise<void>(resolve => { moved = resolve; }));
    const stop = recorder.stop();
    for (let i = 0; i < 100; i++) await Promise.resolve();
    expect(chunks).toHaveLength(0);
    moved(); await stop;
    expect(chunks[0]).toMatchObject({ durationMs: 1000, localPath: 'recordings/native-note/0.m4a', mimeType: 'audio/mp4' });
    expect(MockNativeRecorder.instances.every(item => item.released)).toBe(true);
    expect(mockDeactivate).toHaveBeenCalled();
  });
  it('falls back to sequential preparation when the device rejects a second prepared recorder', async () => {
    mockFailOverlap = true;
    const onChunk = jest.fn(); await recorder.start('note', { onChunk });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(MockNativeRecorder.instances).toHaveLength(3);
    expect(MockNativeRecorder.instances[2].recording).toBe(true);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(MockNativeRecorder.instances).toHaveLength(4);
  });
  it('uses 44.1kHz mono AAC if the device rejects 16kHz', async () => {
    mockFail16k = true; await recorder.start('note', {});
    expect(MockNativeRecorder.instances[1].config).toMatchObject({ sampleRate: 44_100, numberOfChannels: 1, bitRate: 64_000 });
    expect(MockNativeRecorder.instances[0].released).toBe(true);
  });
  it('uses native error events to flush and automatically restart', async () => {
    const onWarning = jest.fn(); const onChunk = jest.fn();
    await recorder.start('note', { onWarning, onChunk });
    await jest.advanceTimersByTimeAsync(1000);
    const old = MockNativeRecorder.instances[0];
    old.listener?.({ hasError: true, error: 'audio focus lost', url: old.uri });
    await jest.advanceTimersByTimeAsync(100);
    expect(onWarning).toHaveBeenCalledWith({ kind: 'interrupted', reason: 'audio focus lost' });
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(MockNativeRecorder.instances[1].recording).toBe(true);
  });
  it('preserves the original capture file if a media reset replaces the SDK URI', async () => {
    const onChunk = jest.fn(); await recorder.start('note', { onChunk });
    await jest.advanceTimersByTimeAsync(1000);
    const old = MockNativeRecorder.instances[0];
    old.uri = 'file:///documents/reset-replacement.m4a';
    old.listener?.({ hasError: false, error: '', url: old.uri, mediaServicesDidReset: true });
    await jest.advanceTimersByTimeAsync(100);
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect(mockFiles.has('file:///documents/recordings/note/0.m4a')).toBe(true);
  });
});

const flushNative = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
it('reads finalized M4A duration and resolves relative paths against Documents', async () => {
  mockDuration = 750;
  const onChunk = jest.fn(); await recorder.start('note', { onChunk });
  await jest.advanceTimersByTimeAsync(1000); await recorder.stop();
  expect(onChunk.mock.calls[0][0]).toMatchObject({ durationMs: 750, localPath: 'recordings/note/0.m4a' });
  const { resolveLocalPath } = require('../paths.native');
  expect(resolveLocalPath((onChunk.mock.calls[0][0] as AudioChunk).localPath)).toBe('file:///documents/recordings/note/0.m4a');
  expect(resolveLocalPath('file:///legacy.m4a')).toBe('file:///legacy.m4a');
});
it('retains missing-file duration and retries when the file reappears', async () => {
  const onChunk = jest.fn(), onWarning = jest.fn(); await recorder.start('note', { onChunk, onWarning });
  await jest.advanceTimersByTimeAsync(1000);
  const uri = MockNativeRecorder.instances[0].uri; mockFiles.delete(uri);
  await recorder.pause(); expect(onChunk).not.toHaveBeenCalled();
  expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('retained 1000ms') }));
  mockFiles.add(uri); await jest.advanceTimersByTimeAsync(1000);
  expect((onChunk.mock.calls[0][0] as AudioChunk).durationMs).toBe(1000);
});
it('retries a failed native move while recording continues', async () => {
  const onChunk = jest.fn(); mockMove.mockRejectedValueOnce(Error('disk busy'));
  await recorder.start('note', { onChunk }); await jest.advanceTimersByTimeAsync(30_000);
  expect(recorder.getState()).toBe('recording'); expect(onChunk).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1000); expect(onChunk).toHaveBeenCalledTimes(1);
});
it('native stop timeout releases the recorder and salvages its file', async () => {
  const onChunk = jest.fn(), onWarning = jest.fn(); await recorder.start('note', { onChunk, onWarning });
  await jest.advanceTimersByTimeAsync(1000); mockHangStop = true;
  const stopping = recorder.stop(); await jest.advanceTimersByTimeAsync(10_000); await stopping;
  expect(MockNativeRecorder.instances[0].released).toBe(true);
  expect(onWarning).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('timed out') }));
  expect(onChunk).toHaveBeenCalledTimes(1);
});
it('native prepare timeout releases its underlying native object', async () => {
  mockHangPrepare = true;
  const starting = recorder.start('note', {}); const rejected = expect(starting).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(10_000); await rejected;
  expect(MockNativeRecorder.instances[0].released).toBe(true);
});
it('AppState active and recordingStatusUpdate run tick without waiting for timers', async () => {
  const { AppState } = require('react-native');
  let changed!: (state: string) => void;
  const remove = jest.fn();
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
    changed = cb as (state: string) => void; return { remove };
  });
  const onChunk = jest.fn(); await recorder.start('note', { onChunk });
  jest.setSystemTime(Date.now() + 30_000);
  // Fake native capture clock can advance while the JS interval is suspended.
  const first = MockNativeRecorder.instances[0]; first.startedAt = performance.now() - 30_000;
  changed('active'); await flushNative(); expect(onChunk).toHaveBeenCalledTimes(1);
  const second = MockNativeRecorder.instances[1]; second.startedAt = performance.now() - 30_000;
  second.listener?.({ hasError: false, error: '', url: second.uri });
  await flushNative(); expect(onChunk).toHaveBeenCalledTimes(2);
  await recorder.stop(); expect(remove).toHaveBeenCalled(); spy.mockRestore();
});

it('metadata timeout still persists the file with its last observed duration', async () => {
  const onChunk = jest.fn(); await recorder.start('metadata', { onChunk });
  await jest.advanceTimersByTimeAsync(1000); mockHangMetadata = true;
  const stopping = recorder.stop(); await jest.advanceTimersByTimeAsync(10_000); await stopping;
  expect(onChunk).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1000, localPath: 'recordings/metadata/0.m4a' }));
  expect(MockNativeRecorder.instances[0].released).toBe(true);
});

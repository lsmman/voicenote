import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AudioChunk } from '../../core/types';

const mockFiles = new Set<string>();
const mockMove = jest.fn<(destination: { uri: string }) => Promise<void>>();
const mockMode = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockActivate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockDeactivate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
let mockFailOverlap = false;
let mockFail16k = false;
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
    if (mockFail16k && config.sampleRate === 16_000) throw new Error('Unsupported sample rate');
    if (mockFailOverlap && MockNativeRecorder.instances.some(item => item.recording)) throw new Error('Microphone busy');
    this.config = config;
  }
  record() { this.recording = true; this.startedAt = performance.now(); mockFiles.add(this.uri); }
  getStatus() {
    return { isRecording: this.recording, canRecord: true, durationMillis: this.recording ? performance.now() - this.startedAt : 0,
      metering: -20, url: this.uri, mediaServicesDidReset: false };
  }
  async stop() { this.recording = false; }
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
    get exists() { return mockFiles.has(this.uri); }
    async move(destination: { uri: string }) { await mockMove(destination); mockFiles.delete(this.uri); mockFiles.add(destination.uri); }
    delete() { mockFiles.delete(this.uri); }
  }
  return { File, Directory, Paths: { document: { uri: 'file:///documents' }, availableDiskSpace: 2_000_000_000 } };
});
// Require after mock classes initialize; imports are hoisted by Babel.
const { recorder } = require('../index.native') as typeof import('../index.native');
beforeEach(() => {
  jest.useFakeTimers(); MockNativeRecorder.instances = []; mockFiles.clear();
  mockMove.mockReset().mockResolvedValue(undefined); mockFailOverlap = false; mockFail16k = false;
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
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(chunks).toHaveLength(0);
    moved(); await stop;
    expect(chunks[0]).toMatchObject({ durationMs: 1000, localPath: 'file:///documents/recordings/native-note/0.m4a', mimeType: 'audio/mp4' });
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

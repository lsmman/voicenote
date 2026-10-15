import type { AudioChunk } from '../../core/types';
import type { WorkerRequest, WorkerResponse } from '../web/protocol';

const mockGetBlob = jest.fn();
jest.mock('../../store', () => ({ store: { getAudioBlob: (...args: unknown[]) => mockGetBlob(...args) } }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = jest.fn();
  sent: { request: WorkerRequest; transfer: Transferable[] }[] = [];
  postMessage(request: WorkerRequest, transfer: Transferable[]) { this.sent.push({ request, transfer }); }
  constructor(public url: string, public options: WorkerOptions) { FakeWorker.instances.push(this); }
  reply(segments = [{ text: 'test', startMs: 2000, endMs: 3000 }]) {
    this.onmessage?.({ data: { id: this.sent.at(-1)!.request.id, kind: 'result', segments } });
  }
}
const marker = new Map<string, string>();
const mockCacheKeys = jest.fn();
const mockDecode = jest.fn();
const mockClose = jest.fn(async () => {});
const mockContext = jest.fn(() => ({ decodeAudioData: mockDecode, close: mockClose }));
let engine: typeof import('../index').engine;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const target = () => FakeWorker.instances.at(-1)!;
const chunk = { localPath: 'audio', durationMs: 1000 } as AudioChunk;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  FakeWorker.instances = [];
  marker.clear();
  Object.defineProperties(globalThis, {
    Worker: { configurable: true, value: FakeWorker },
    AudioContext: { configurable: true, value: mockContext },
    localStorage: { configurable: true, value: {
      getItem: (key: string) => marker.get(key), setItem: (key: string, value: string) => marker.set(key, value),
      removeItem: (key: string) => marker.delete(key),
    } },
    caches: { configurable: true, value: { open: jest.fn(async () => ({ keys: mockCacheKeys })) } },
  });
  mockCacheKeys.mockResolvedValue([]);
  mockGetBlob.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(0) });
  mockDecode.mockResolvedValue({ sampleRate: 48000, numberOfChannels: 1,
    getChannelData: () => new Float32Array(48000) });
  engine = require('../index.ts').engine;
});
afterEach(() => { jest.useRealTimers(); });

async function load() {
  const promise = engine.load('base-q5_1');
  await flush();
  target().reply();
  await promise;
}

test('static worker, load timeout and fresh worker on retry', async () => {
  const promise = engine.load('base-q5_1');
  const rejected = expect(promise).rejects.toThrow('timed out');
  await flush();
  const first = target();
  expect(first.url).toBe('/transcribe-worker.js');
  expect(first.options).toEqual({ type: 'module' });
  jest.advanceTimersByTime(30 * 60_000 - 1);
  expect(first.terminate).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);
  await rejected;
  expect(first.terminate).toHaveBeenCalledTimes(1);
  await load();
  expect(FakeWorker.instances).toHaveLength(2);
  expect(jest.getTimerCount()).toBe(0);
});

test('inference deadline terminates worker and closes native-rate context', async () => {
  await load();
  const promise = engine.transcribeChunk(chunk, { language: 'ko' });
  const rejected = expect(promise).rejects.toThrow('transcribe timed out');
  await flush();
  expect(mockContext).toHaveBeenCalledWith();
  jest.advanceTimersByTime(10 * 60_000);
  await rejected;
  expect(target().terminate).toHaveBeenCalledTimes(1);
  expect(mockClose).toHaveBeenCalledTimes(1);
  await load();
  expect(FakeWorker.instances).toHaveLength(2);
});

test('readiness requires a repo cache entry and clears evicted markers', async () => {
  await load();
  mockCacheKeys.mockResolvedValue([{ url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/config.json' }]);
  expect(await engine.isModelReady('base-q5_1')).toBe(true);
  expect(caches.open).toHaveBeenCalledWith('transformers-cache');
  mockCacheKeys.mockResolvedValue([{ url: 'https://huggingface.co/onnx-community/whisper-base-extra/resolve/main/config.json' }]);
  expect(await engine.isModelReady('base-q5_1')).toBe(false);
  expect(marker.size).toBe(0);
});

test.each(['ko', 'en', 'zh'] as const)('long audio windows carry %s with owned transfers and absolute offsets', async language => {
  await load();
  const audio = new Float32Array(16000 * 74);
  mockDecode.mockResolvedValue({ sampleRate: 16000, numberOfChannels: 1, getChannelData: () => audio });
  const promise = engine.transcribeChunk(chunk, { language });
  await flush();
  expect(target().sent).toHaveLength(2); // load + first inference, not all windows
  const lengths: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const sent = target().sent[i];
    if (sent.request.kind !== 'transcribe') throw new Error('Expected audio');
    expect(sent.request.language).toBe(language);
    lengths.push(sent.request.audio.length);
    expect(sent.transfer).toEqual([sent.request.audio.buffer]);
    expect(sent.request.audio.buffer).not.toBe(audio.buffer);
    target().reply(i === 3 ? [{ text: 'end', startMs: 1000, endMs: 2000 }] : undefined);
    await flush();
  }
  expect(lengths.every(n => n <= 16000 * 30)).toBe(true);
  const result = await promise;
  expect(result[0]).toEqual({ text: 'test', startMs: 2000, endMs: 3000 });
  const lastStart = (16000 * 74 - lengths[2]) / 16; // ms offset of the last window
  expect(result.at(-1)!.text).toBe('end');
  expect(result.at(-1)!.startMs).toBeCloseTo(lastStart + 1000, 0);
  expect(jest.getTimerCount()).toBe(0);
});

test('worker failure rejects the active request and allows reload', async () => {
  const promise = engine.load('base-q5_1');
  const rejected = expect(promise).rejects.toThrow('worker failed');
  await flush();
  target().onerror?.();
  await rejected;
  expect(jest.getTimerCount()).toBe(0);
  await load();
  expect(FakeWorker.instances).toHaveLength(2);
});

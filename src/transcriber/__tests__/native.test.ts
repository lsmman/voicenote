import type { AudioChunk } from '../../core/types';

const mockFiles = new Map<string, number>();
const mockRelease = jest.fn(async () => undefined);
const mockTranscribe = jest.fn((_data: string | ArrayBuffer, _options: unknown) => ({ promise: Promise.resolve({
  isAborted: false, segments: [{ text: '안녕하세요', t0: 12, t1: 123 }],
}) }));
const mockTranscribeData = jest.fn((_data: string | ArrayBuffer, _options: unknown) => ({
  promise: Promise.resolve({ isAborted: false, segments: [{ text: '안녕하세요', t0: 12, t1: 123 }] }),
}));
const mockDuration = jest.fn(async () => 601);
const mockDecode = jest.fn(async (_path: string, _rate: number) => ({
  sampleRate: 16000, length: 2, numberOfChannels: 2,
  copyFromChannel: (out: Float32Array, channel: number, _start = 0) => { out.set(channel ? [0, -1] : [1, 0]); },
}));
jest.mock('react-native-audio-api', () => ({
  decodeAudioData: (...args: Parameters<typeof mockDecode>) => mockDecode(...args),
  getAudioDuration: () => mockDuration(),
}));
const mockInit = jest.fn(async () => ({ release: mockRelease, transcribe: mockTranscribe, transcribeData: mockTranscribeData }));
let mockDownloadSize = 60_000_000;
let mockStatus = 200;
const mockMove = jest.fn(async ({ from, to }: { from: string; to: string }) => {
  mockFiles.set(to, mockFiles.get(from)!);
  mockFiles.delete(from);
});

jest.mock('whisper.rn/index', () => ({ initWhisper: (...args: unknown[]) => mockInit(...args as []) }));
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: async (path: string) => mockFiles.has(path)
    ? { exists: true, isDirectory: false, size: mockFiles.get(path) } : { exists: false },
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: async (path: string) => { mockFiles.delete(path); },
  moveAsync: (...args: Parameters<typeof mockMove>) => mockMove(...args),
  createDownloadResumable: (_url: string, path: string, _options: unknown, progress: Function) => ({
    downloadAsync: async () => {
      mockFiles.set(path, mockDownloadSize);
      progress({ totalBytesWritten: mockDownloadSize, totalBytesExpectedToWrite: mockDownloadSize });
      return { status: mockStatus, uri: path };
    },
  }),
}));

import { engine } from '../index.native';

const path = 'file:///documents/models/ggml-base-q5_1.bin';
const chunk: AudioChunk = { noteId: 'note', seq: 0, startMs: 5000, durationMs: 30_000,
  localPath: 'file:///audio.m4a', mimeType: 'audio/mp4', remotePath: null, uploadedAt: null, transcribedAt: null };

beforeEach(async () => {
  await engine.deleteModel('base-q5_1');
  await engine.deleteModel('small-q5_1');
  mockFiles.clear();
  jest.clearAllMocks();
  mockDownloadSize = 60_000_000;
  mockStatus = 200;
});

test('download verifies the partial file before promotion and reports bytes', async () => {
  const progress = jest.fn();
  await engine.downloadModel('base-q5_1', progress);
  expect(mockMove).toHaveBeenCalledWith({ from: `${path}.part`, to: path });
  expect(await engine.isModelReady('base-q5_1')).toBe(true);
  expect(mockFiles.has(`${path}.part`)).toBe(false);
  expect(progress).toHaveBeenLastCalledWith({ modelId: 'base-q5_1', receivedBytes: 60_000_000, totalBytes: 60_000_000 });
});

test.each([100, 53_729_999])('rejects incomplete download of %i bytes', async (size) => {
  mockDownloadSize = size;
  await expect(engine.downloadModel('base-q5_1')).rejects.toThrow('Incomplete');
  expect(mockMove).not.toHaveBeenCalled();
  expect(await engine.isModelReady('base-q5_1')).toBe(false);
  expect(mockFiles.has(`${path}.part`)).toBe(false);
});

test('rejects HTTP errors even with a large response', async () => {
  mockStatus = 404;
  await expect(engine.downloadModel('base-q5_1')).rejects.toThrow('download failed');
  expect(mockMove).not.toHaveBeenCalled();
});

test('keeps one context, releases on model change and deletion', async () => {
  mockFiles.set(path, 60_000_000);
  mockFiles.set('file:///documents/models/ggml-small-q5_1.bin', 190_000_000);
  await engine.load('base-q5_1');
  await engine.load('base-q5_1');
  expect(mockInit).toHaveBeenCalledTimes(1);
  await engine.load('small-q5_1');
  expect(mockRelease).toHaveBeenCalledTimes(1);
  await engine.deleteModel('small-q5_1');
  expect(mockRelease).toHaveBeenCalledTimes(2);
});

test('requires local model/audio and maps 10ms ticks relative to the chunk', async () => {
  await expect(engine.load('base-q5_1')).rejects.toThrow('not downloaded');
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  await expect(engine.transcribeChunk({ ...chunk, localPath: null }, { language: 'ko' })).rejects.toThrow('local path');
  expect(await engine.transcribeChunk(chunk, { language: 'ko', prompt: '이전 문장' })).toEqual([
    { text: '안녕하세요', startMs: 120, endMs: 1230 },
  ]);
  expect(mockDecode).toHaveBeenCalledWith(chunk.localPath, 16000);
  expect(Array.from(new Int16Array(mockTranscribeData.mock.calls[0][0] as ArrayBuffer))).toEqual([16384, -16384]);
  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(mockTranscribeData).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
    language: 'ko', prompt: '이전 문장', maxLen: 0, tokenTimestamps: true,
  });
});


test('prepends actual previous audio and shifts times by the available tail', async () => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  const segments = await engine.transcribeChunk(chunk, {
    language: 'ko', prevChunk: { ...chunk, localPath: 'file:///previous.m4a' },
  });
  expect(mockDecode.mock.calls.map(([file]) => file)).toEqual(['file:///previous.m4a', chunk.localPath]);
  expect(Array.from(new Int16Array(mockTranscribeData.mock.calls[0][0] as ArrayBuffer)))
    .toEqual([16384, -16384, 16384, -16384]);
  expect(segments[0].startMs).toBe(119.875);
});

test('long WAV without overlap uses the original path; compressed files never do', async () => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  await engine.transcribeChunk({ ...chunk, localPath: 'file:///import.WAV' }, { language: 'ko' });
  expect(mockTranscribe).toHaveBeenCalledWith('file:///import.WAV', expect.any(Object));
  expect(mockDecode).not.toHaveBeenCalled();
  expect(mockTranscribeData).not.toHaveBeenCalled();
});

test('long compressed input transcribes successive windows with chunk-relative times', async () => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  mockDecode.mockResolvedValueOnce({ sampleRate: 16000, length: 9_600_001, numberOfChannels: 1,
    copyFromChannel: (out) => { out.fill(0.5); } });
  const segments = await engine.transcribeChunk({ ...chunk, localPath: 'file:///import.mp3' }, { language: 'ko' });
  expect(mockDecode).toHaveBeenCalledTimes(1);
  expect(mockTranscribe).not.toHaveBeenCalled();
  expect(mockTranscribeData.mock.calls.map(([data]) => (data as ArrayBuffer).byteLength)).toEqual([19_200_000, 2]);
  expect(segments.map((segment) => segment.startMs)).toEqual([120, 600120]);
});

test('rejects decode errors, wrong sample rates and aborted inference', async () => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  mockDecode.mockRejectedValueOnce(new Error('bad audio'));
  await expect(engine.transcribeChunk(chunk, { language: 'ko' })).rejects.toThrow('bad audio');
  mockDecode.mockResolvedValueOnce({ sampleRate: 48000, length: 0, numberOfChannels: 1, copyFromChannel: () => {} });
  await expect(engine.transcribeChunk(chunk, { language: 'ko' })).rejects.toThrow('16 kHz');
  mockTranscribeData.mockReturnValueOnce({ promise: Promise.resolve({ isAborted: true, segments: [] }) });
  await expect(engine.transcribeChunk(chunk, { language: 'ko' })).rejects.toThrow('aborted');
});

test('a full second of real overlap produces negative segment times', async () => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  mockDecode.mockResolvedValueOnce({ sampleRate: 16000, length: 32_000, numberOfChannels: 1,
    copyFromChannel: (out, _channel, start) => {
      expect(start).toBe(16_000);
      out.fill(-0.5);
    } });
  const segments = await engine.transcribeChunk(chunk, { language: 'ko', prevChunk: chunk });
  expect(segments[0]).toEqual({ text: '안녕하세요', startMs: -880, endMs: 230 });
  expect(new DataView(mockTranscribeData.mock.calls[0][0] as ArrayBuffer).getInt16(0, true)).toBe(-16384);
});

test.each(['ko', 'en', 'zh'] as const)('passes %s to whisper.cpp', async language => {
  mockFiles.set(path, 60_000_000);
  await engine.load('base-q5_1');
  await engine.transcribeChunk(chunk, { language });
  expect(mockTranscribeData).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.objectContaining({ language }));
});

import type { AudioChunk } from '../../core/types';

const mockFiles = new Map<string, number>();
const mockRelease = jest.fn(async () => undefined);
const mockTranscribe = jest.fn(() => ({ promise: Promise.resolve({
  isAborted: false, segments: [{ text: '안녕하세요', t0: 12, t1: 123 }],
}) }));
const mockInit = jest.fn(async () => ({ release: mockRelease, transcribe: mockTranscribe }));
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
  expect(mockTranscribe).toHaveBeenCalledWith(chunk.localPath, {
    language: 'ko', prompt: '이전 문장', maxLen: 0, tokenTimestamps: true,
  });
});

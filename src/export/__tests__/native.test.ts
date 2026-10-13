import { buildMp4aSampleEntry, muxAac } from '../mp4';
const mockChunks = jest.fn(); const mockShare = jest.fn(); const mockAvailable = jest.fn();
const mockWrite = jest.fn(); const mockClose = jest.fn(); const mockCreate = jest.fn(); const mockResolve = jest.fn((path: string) => `file:///documents/${path}`);
const mockBytes = new Map<string, Uint8Array>();
jest.mock('../../store', () => ({ store: { listChunks: (...args: unknown[]) => mockChunks(...args) } }));
jest.mock('../../recorder/paths', () => ({ resolveLocalPath: (path: string) => mockResolve(path) }));
jest.mock('expo-sharing', () => ({ shareAsync: (...args: unknown[]) => mockShare(...args), isAvailableAsync: () => mockAvailable() }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'file:///cache' }, File: class {
  uri: string;
  constructor(...parts: string[]) { this.uri = parts.join('/'); }
  get exists() { return mockBytes.has(this.uri); }
  async bytes() { return mockBytes.get(this.uri); }
  create(options: unknown) { mockCreate(this.uri, options); }
  open() { return { writeBytes: mockWrite, close: mockClose }; }
} }));
const { exportNoteAudio } = require('../index.native') as typeof import('../index.native');
beforeEach(() => { jest.clearAllMocks(); mockBytes.clear(); mockAvailable.mockResolvedValue(true); mockShare.mockResolvedValue(undefined); });
test('reads in seq order, resolves relative paths, closes output and shares M4A', async () => {
  const entry = buildMp4aSampleEntry(Uint8Array.of(0x14, 8), 16000);
  const file = (n: number) => { const parts = muxAac({ sampleEntry: entry, timescale: 16000, samples: [{ data: Uint8Array.of(n), duration: 1024 }] }); return Uint8Array.from(parts.flatMap(p => Array.from(p))); };
  mockChunks.mockResolvedValue([{ seq: 1, localPath: 'b', mimeType: 'audio/mp4' }, { seq: 0, localPath: 'a', mimeType: 'audio/mp4' }]);
  mockBytes.set('file:///documents/a', file(11)); mockBytes.set('file:///documents/b', file(22));
  const progress = jest.fn(); await exportNoteAudio('note', 'a/b', progress);
  expect(mockResolve.mock.calls).toEqual([['a'], ['b']]);
  expect(mockCreate).toHaveBeenCalledWith('file:///cache/a_b.m4a', { overwrite: true });
  expect(mockWrite.mock.calls.slice(-2)).toEqual([[Uint8Array.of(11)], [Uint8Array.of(22)]]);
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(mockShare).toHaveBeenCalledWith('file:///cache/a_b.m4a', { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' });
  expect(progress.mock.calls.flat()).toEqual([0, 0.5, 1]);
});
test('shares original imported MP3', async () => {
  mockChunks.mockResolvedValue([{ seq: 0, localPath: 'original.mp3', mimeType: 'audio/mpeg' }]); mockBytes.set('file:///documents/original.mp3', Uint8Array.of(1));
  await exportNoteAudio('n', 'Title'); expect(mockWrite).not.toHaveBeenCalled();
  expect(mockShare).toHaveBeenCalledWith('file:///documents/original.mp3', { mimeType: 'audio/mpeg' });
});
test('missing local audio fails without sharing', async () => {
  mockChunks.mockResolvedValue([{ seq: 0, localPath: null, mimeType: 'audio/mp4' }]);
  await expect(exportNoteAudio('n', 't')).rejects.toThrow(/not available locally/); expect(mockShare).not.toHaveBeenCalled();
});

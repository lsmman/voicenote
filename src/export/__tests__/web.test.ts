import { Blob as NodeBlob } from 'buffer';
import { buildMp4aSampleEntry, muxAac, parseM4a } from '../mp4';
const mockChunks = jest.fn(), mockBlob = jest.fn();
jest.mock('../../store', () => ({ store: { listChunks: (...args: unknown[]) => mockChunks(...args), getAudioBlob: (...args: unknown[]) => mockBlob(...args) } }));
const { exportNoteAudio } = require('../index.ts') as typeof import('../index');
const original = new Map<string, PropertyDescriptor | undefined>();
function globalValue(name: string, value: unknown) { if (!original.has(name)) original.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, value, writable: true }); }
const createURL = jest.fn(), revokeURL = jest.fn(), click = jest.fn(), close = jest.fn(), frameClose = jest.fn();
let link: { href: string; download: string; click: typeof click; remove: () => void };
let supported = false;
let encoderFlushes = 0;
class Encoder {
  static async isConfigSupported() { return { supported }; }
  state = 'configured'; encodeQueueSize = 0;
  constructor(private callbacks: { output: (chunk: unknown, metadata: unknown) => void }) {}
  configure() {}
  encode(frame: { init: { numberOfFrames: number } }) {
    this.callbacks.output({ byteLength: 1, duration: Math.round(frame.init.numberOfFrames * 1e6 / 48000), copyTo: (b: Uint8Array) => { b[0] = 42; } }, { decoderConfig: { description: Uint8Array.of(0x11, 0x88) } });
  }
  async flush() { encoderFlushes++; }
  close() { this.state = 'closed'; close(); }
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); supported = false; encoderFlushes = 0;
  globalValue('Blob', NodeBlob); createURL.mockReturnValue('blob:export'); globalValue('URL', { createObjectURL: createURL, revokeObjectURL: revokeURL });
  link = { href: '', download: '', click, remove: jest.fn() }; globalValue('document', { createElement: () => link, body: { appendChild: jest.fn() } });
  globalValue('AudioContext', class { sampleRate = 48000; async decodeAudioData() { return { length: 1024, sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(1024).fill(0.5) }; } async close() { close(); } });
  globalValue('AudioEncoder', Encoder); globalValue('AudioData', class { constructor(public init: unknown) {} close() { frameClose(); } });
  mockChunks.mockResolvedValue([1, 0].map(seq => ({ seq, localPath: `n/${seq}`, mimeType: 'audio/webm' })));
  mockBlob.mockResolvedValue(new NodeBlob(['fake'], { type: 'audio/webm' }));
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); for (const [name, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } original.clear(); });
test('unsupported AAC downloads one PCM WAV and revokes URL', async () => {
  const progress = jest.fn(); await exportNoteAudio('n', 'Whole', progress);
  expect(link.download).toBe('Whole.wav'); expect(click).toHaveBeenCalledTimes(1);
  expect(mockBlob.mock.calls).toEqual([['n/0'], ['n/1']]); expect(progress.mock.calls.flat()).toEqual([0, 0.5, 1]);
  const blob = createURL.mock.calls[0][0]; const bytes = await blob.arrayBuffer(); expect(new DataView(bytes).getUint32(40, true)).toBe(4096);
  expect(close).toHaveBeenCalledTimes(1); jest.runOnlyPendingTimers(); expect(revokeURL).toHaveBeenCalledWith('blob:export');
});
test('AAC encoder produces one M4A, closes frames and flushes once', async () => {
  supported = true; await exportNoteAudio('n', 'Whole'); expect(link.download).toBe('Whole.m4a');
  const parsed = parseM4a(new Uint8Array(await createURL.mock.calls[0][0].arrayBuffer()));
  expect(parsed.samples.map(s => s.duration)).toEqual([1024, 1024]); expect(frameClose).toHaveBeenCalledTimes(2); expect(encoderFlushes).toBe(1); expect(close).toHaveBeenCalledTimes(2);
});
test('single imported blob is downloaded unchanged with original format', async () => {
  const blob = new NodeBlob(['mp3'], { type: 'audio/mpeg' }); mockChunks.mockResolvedValue([{ seq: 0, localPath: 'import', mimeType: 'audio/mpeg' }]); mockBlob.mockResolvedValue(blob);
  await exportNoteAudio('n', 'Original'); expect(createURL).toHaveBeenCalledWith(blob); expect(link.download).toBe('Original.mp3'); expect(close).not.toHaveBeenCalled();
});
test('Safari MP4 chunks remux in sequence without decoding', async () => {
  const entry = buildMp4aSampleEntry(Uint8Array.of(0x11, 0x88), 48000);
  mockChunks.mockResolvedValue([1, 0].map(seq => ({ seq, localPath: `${seq}`, mimeType: 'audio/mp4' })));
  mockBlob.mockImplementation(async (key: string) => new NodeBlob(muxAac({ sampleEntry: entry, timescale: 48000, samples: [{ data: Uint8Array.of(Number(key)), duration: 1024 }] }) as Uint8Array<ArrayBuffer>[], { type: 'audio/mp4' }));
  await exportNoteAudio('n', 'Safari'); const bytes = new Uint8Array(await createURL.mock.calls[0][0].arrayBuffer());
  expect(parseM4a(bytes).samples.map(s => bytes[s.offset])).toEqual([0, 1]); expect(close).not.toHaveBeenCalled();
});
test('missing blob does not download and closes decoder', async () => {
  mockBlob.mockResolvedValue(null); await expect(exportNoteAudio('n', 'Missing')).rejects.toThrow(/missing/); expect(createURL).not.toHaveBeenCalled(); expect(close).toHaveBeenCalled();
});

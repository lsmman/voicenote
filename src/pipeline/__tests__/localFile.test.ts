/// <reference types="jest" />
import { fakes } from '../testing/fakes';

jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///documents' } },
  Directory: jest.fn().mockImplementation((parent, ...parts) => ({ uri: [parent.uri, ...parts].join('/'), create: jest.fn() })),
  File: jest.fn().mockImplementation((parent, ...parts) => ({
    uri: [typeof parent === 'string' ? parent : parent.uri, ...parts].join('/'),
    copy: jest.fn(async () => {}),
  })),
}));
jest.mock('react-native-audio-api', () => ({ getAudioDuration: jest.fn(async () => 12.345) }));
import { File, Directory } from 'expo-file-system';
import { getAudioDuration } from 'react-native-audio-api';
import { prepareImportedAudio as nativeImport } from '../localFile.native';
const web = jest.requireActual('../localFile.ts') as typeof import('../localFile');

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('native import awaits app-owned copy before probing real duration', async () => {
  const f = fakes(); const result = await nativeImport('content://picked', 'voice.M4A', 'n', f.deps.store);
  expect(result).toEqual({ localPath: 'file:///documents/recordings/n/import.m4a', durationMs: 12345 });
  const directory = jest.mocked(Directory).mock.results[0].value;
  expect(directory.create).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
  const source = jest.mocked(File).mock.results[1].value;
  expect(source.copy).toHaveBeenCalledWith(expect.objectContaining({ uri: result.localPath }));
  expect(getAudioDuration).toHaveBeenCalledWith(result.localPath);
  expect(source.copy.mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(getAudioDuration).mock.invocationCallOrder[0]);
});

test('web import reads loadedmetadata from object URL and revokes it', async () => {
  const f = fakes(); const blob = new Blob(['audio']);
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const originalFetch = global.fetch;
  const audio = { duration: 8.25, onloadedmetadata: null as (() => void) | null, onerror: null, src: '', preload: '', removeAttribute: jest.fn(), load: jest.fn() };
  const revoke = jest.fn();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: jest.fn(() => audio) } });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: jest.fn(() => 'blob:metadata') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  global.fetch = jest.fn(async () => ({ ok: true, blob: async () => blob })) as unknown as typeof fetch;
  try {
    const imported = web.prepareImportedAudio('blob:picked', 'clip.webm', 'n', f.deps.store);
    await jest.advanceTimersByTimeAsync(0);
    expect(audio.src).toBe('blob:metadata'); expect(f.blobs.size).toBe(0);
    audio.onloadedmetadata!();
    expect(await imported).toEqual({ localPath: 'n/0', durationMs: 8250 });
    expect(f.blobs.get('n/0')).toBe(blob); expect(revoke).toHaveBeenCalledWith('blob:metadata');
  } finally {
    global.fetch = originalFetch;
    for (const [object, key, descriptor] of [[globalThis, 'document', originalDocument], [URL, 'createObjectURL', originalCreate], [URL, 'revokeObjectURL', originalRevoke]] as const) {
      if (descriptor) Object.defineProperty(object, key, descriptor); else Reflect.deleteProperty(object, key);
    }
  }
});

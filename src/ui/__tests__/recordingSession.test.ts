import { setLanguage } from '../../i18n/language';
import { alreadyActive, recordingLockHeld, RECORDING_LOCK, startOrAttachRecording, webLocks } from '../recordingSession';
import type { LiveSessionState, Pipeline } from '../../pipeline/types';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await setLanguage('ko'); });
const live = { noteId: 'n', state: 'recording' } as LiveSessionState;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const listeners = new Set<(s: LiveSessionState | null) => void>();
  let state: LiveSessionState | null = null;
  const emit = (next: LiveSessionState | null) => { state = next; for (const listener of listeners) listener(next); };
  const pipeline = {
    subscribe: jest.fn((listener: (s: LiveSessionState | null) => void) => { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; }),
    startRecording: jest.fn(async () => { emit(live); return 'n'; }),
  } as unknown as Pipeline;
  let held = false;
  const locks = { request: jest.fn(async (_name, _options, callback) => { held = true; try { await callback({ name: RECORDING_LOCK }); } finally { held = false; } }) } as unknown as LockManager;
  return { pipeline, locks, emit, listeners, held: () => held };
}
test('held check ignores pending and unrelated locks; native feature detection is off', () => {
  expect(recordingLockHeld({})).toBe(false);
  expect(recordingLockHeld({ held: [{ name: 'other' }] })).toBe(false);
  expect(recordingLockHeld({ held: [{ name: RECORDING_LOCK }] })).toBe(true);
  expect(webLocks(false)).toBeUndefined();
  expect(alreadyActive(new Error('Recording already active'))).toBe(true);
  expect(alreadyActive(new Error('Permission denied'))).toBe(false);
});
test('one exclusive lock and one start across reattachments, released only when the session ends', async () => {
  const f = fixture();
  const first = startOrAttachRecording(f.pipeline, f.locks);
  expect(startOrAttachRecording(f.pipeline, f.locks)).toBe(first);
  await expect(first).resolves.toBe('n');
  expect(f.locks.request).toHaveBeenCalledWith(RECORDING_LOCK, { mode: 'exclusive', ifAvailable: true }, expect.any(Function));
  expect(f.pipeline.startRecording).toHaveBeenCalledTimes(1);
  expect(f.held()).toBe(true);
  f.emit({ ...live, state: 'paused' }); expect(f.held()).toBe(true);
  f.emit(null); await flush(); expect(f.held()).toBe(false); expect(f.listeners.size).toBe(0);
});
test('busy other tab never starts recording', async () => {
  const f = fixture(); (f.locks.request as jest.Mock).mockImplementation(async (_name, _options, callback) => callback(null));
  await expect(startOrAttachRecording(f.pipeline, f.locks)).rejects.toThrow('다른 탭');
  expect(f.pipeline.startRecording).not.toHaveBeenCalled(); await flush();
});
test('already active race reattaches through subsequent subscription notification', async () => {
  const f = fixture(); (f.pipeline.startRecording as jest.Mock).mockRejectedValue(new Error('Recording already active'));
  const start = startOrAttachRecording(f.pipeline, f.locks); await flush(); f.emit(live);
  await expect(start).resolves.toBe('n'); expect(f.held()).toBe(true);
  f.emit(null); await flush();
});
test('failed start releases lock and permits retry', async () => {
  const f = fixture(); (f.pipeline.startRecording as jest.Mock).mockRejectedValueOnce(new Error('denied'));
  await expect(startOrAttachRecording(f.pipeline, f.locks)).rejects.toThrow('denied'); await flush(); expect(f.held()).toBe(false);
  await expect(startOrAttachRecording(f.pipeline, f.locks)).resolves.toBe('n'); f.emit(null); await flush();
});

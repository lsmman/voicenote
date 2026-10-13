import { recoverUnfinished } from '../recovery';
import { RECORDING_LOCK } from '../recordingSession';
import type { Note } from '../../core/types';
const notes = ['a', 'b', 'c'].map(id => ({ id, title: id, status: 'recording' } as Note));
function fixture() {
  return {
    pipeline: { findUnfinished: jest.fn(async () => notes), recover: jest.fn(async (_id: string) => {}) },
    store: { getNote: jest.fn(async (id: string) => notes.find(n => n.id === id)!), deleteNote: jest.fn(async (_id: string) => {}) },
    web: false, seen: new Set<string>(), choose: jest.fn(async () => 'recover' as const), onError: jest.fn(),
  };
}
test('each failed recovery is isolated and every note is offered only once per session', async () => {
  const f = fixture(); f.pipeline.recover.mockRejectedValueOnce(new Error('bad journal'));
  await recoverUnfinished(f); await recoverUnfinished(f);
  expect(f.choose).toHaveBeenCalledTimes(3); expect(f.onError).toHaveBeenCalledTimes(1);
  expect(f.pipeline.recover.mock.calls).toEqual([['a'], ['b'], ['c']]);
});
test('discard deletes only its note and later leaves its note untouched', async () => {
  const f = fixture(); const choose = jest.fn().mockResolvedValueOnce('discard').mockResolvedValueOnce('later').mockResolvedValueOnce('recover');
  await recoverUnfinished({ ...f, choose });
  expect(f.store.deleteNote.mock.calls).toEqual([['a']]); expect(f.pipeline.recover.mock.calls).toEqual([['c']]);
});
test('held lock and unavailable Web Locks never offer web recording recovery', async () => {
  const f = fixture(); const locks = { query: jest.fn(async () => ({ held: [{ name: RECORDING_LOCK }] })), request: jest.fn() } as unknown as LockManager;
  await recoverUnfinished({ ...f, web: true, locks }); await recoverUnfinished({ ...f, web: true });
  expect(f.choose).not.toHaveBeenCalled(); expect(locks.request).not.toHaveBeenCalled(); expect(f.seen.size).toBe(0);
});
test('free queried lock is acquired before prompting; a lost race skips the prompt', async () => {
  const f = fixture(); let held = false;
  const locks = {
    query: jest.fn(async () => ({ held: [] })),
    request: jest.fn(async (_name, _options, callback) => { held = true; try { await callback({ name: RECORDING_LOCK }); } finally { held = false; } }),
  } as unknown as LockManager;
  const choose = jest.fn(async () => { expect(held).toBe(true); return 'later' as const; });
  await recoverUnfinished({ ...f, web: true, locks, choose }); expect(choose).toHaveBeenCalledTimes(3);
  f.seen.clear(); (locks.request as jest.Mock).mockImplementation(async (_name, _options, callback) => callback(null));
  await recoverUnfinished({ ...f, web: true, locks, choose }); expect(choose).toHaveBeenCalledTimes(3);
});
test('notes already finalized in another tab are not offered', async () => {
  const f = fixture(); f.store.getNote.mockResolvedValue({ ...notes[0], status: 'done' });
  await recoverUnfinished(f); expect(f.choose).not.toHaveBeenCalled();
});

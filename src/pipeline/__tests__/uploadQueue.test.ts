/// <reference types="jest" />
import { createCleanupLocal, createUploadQueue } from '../uploadQueue';
import { chunk, fakes, note } from '../testing/fakes';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('serial uploads preserve sequence, retry at 2s then 4s, and keep audio', async () => {
  const f = fakes();
  await f.deps.store.createNote(note());
  await f.deps.store.addChunk(chunk('note', 1));
  await f.deps.store.addChunk(chunk());
  const upload = jest.mocked(f.deps.sync.uploadChunk);
  upload.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline'));
  const queue = createUploadQueue(f.deps);
  await Promise.all([queue.resume(), queue.resume()]);
  expect(upload.mock.calls.map(([c]) => c.seq)).toEqual([0]);
  await jest.advanceTimersByTimeAsync(1999);
  expect(upload).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(upload).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(4000);
  expect(upload.mock.calls.map(([c]) => c.seq)).toEqual([0, 0, 0, 1]);
  expect((await f.deps.store.listChunks('note')).every(c => c.remotePath && c.uploadedAt && c.localPath)).toBe(true);
  expect(f.deps.store.deleteAudioBlob).not.toHaveBeenCalled();
});

test.each(['isOnline', 'isSignedIn'] as const)('pauses when %s is false and resumes after retry', async key => {
  const f = fakes();
  await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  jest.mocked(f.deps[key]).mockResolvedValue(false);
  const queue = createUploadQueue(f.deps);
  await queue.resume(); expect(f.deps.sync.uploadChunk).not.toHaveBeenCalled();
  jest.mocked(f.deps[key]).mockResolvedValue(true);
  await jest.advanceTimersByTimeAsync(2000);
  expect(f.deps.sync.uploadChunk).toHaveBeenCalledTimes(1);
});

test('backoff caps at five minutes', async () => {
  const f = fakes();
  await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  jest.mocked(f.deps.sync.uploadChunk).mockRejectedValue(new Error('failed'));
  await createUploadQueue(f.deps).resume();
  let count = 1;
  for (const delay of [2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000, 300000]) {
    await jest.advanceTimersByTimeAsync(delay - 1);
    expect(f.deps.sync.uploadChunk).toHaveBeenCalledTimes(count);
    await jest.advanceTimersByTimeAsync(1);
    expect(f.deps.sync.uploadChunk).toHaveBeenCalledTimes(++count);
  }
});

test('explicit cleanup requires done and every chunk confirmed uploaded', async () => {
  const f = fakes();
  await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  const cleanup = createCleanupLocal(f.deps.store, jest.fn());
  await cleanup('note');
  await f.deps.store.updateNote('note', { status: 'done' }); await cleanup('note');
  expect(f.deps.store.deleteAudioBlob).not.toHaveBeenCalled();
  await createUploadQueue(f.deps).resume(); await cleanup('note');
  expect(f.deps.store.deleteAudioBlob).toHaveBeenCalledWith('note/0');
  expect(f.chunks.get('note/0')?.localPath).toBeNull();
});

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
  upload.mockImplementation(async c => {
    if (c.seq === 0 && upload.mock.calls.filter(([item]) => item.seq === 0).length <= 2) throw new Error('offline');
    return `remote/${c.noteId}/${c.seq}`;
  });
  const queue = createUploadQueue(f.deps);
  await Promise.all([queue.resume(), queue.resume()]);
  expect(upload.mock.calls.map(([c]) => c.seq)).toEqual([0, 1]);
  await jest.advanceTimersByTimeAsync(1999);
  expect(upload).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1);
  expect(upload).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(4000);
  expect(upload.mock.calls.map(([c]) => c.seq)).toEqual([0, 1, 0, 0]);
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

test.each([
  new Error('ENOENT: no such file'), new Error('오디오 파일이 없습니다.'),
  new Error('동기화가 설정되지 않았습니다'), new Error('HTTP 413'),
  { status: 401 }, { statusCode: '404' }, { response: { status: 429 } },
])('permanent upload error %p is skipped without blocking following chunks', async error => {
  const f = fakes(); await f.deps.store.createNote(note());
  await f.deps.store.addChunk(chunk()); await f.deps.store.addChunk(chunk('note', 1));
  jest.mocked(f.deps.sync.uploadChunk).mockRejectedValueOnce(error);
  const q = createUploadQueue(f.deps); await q.resume(); await q.resume(true);
  expect(jest.mocked(f.deps.sync.uploadChunk).mock.calls.map(([c]) => c.seq)).toEqual([0, 1]);
  expect(f.chunks.get('note/0')?.remotePath).toBeNull();
  expect(f.chunks.get('note/1')?.remotePath).toBeTruthy();
});

test('transient backoff is per chunk across notes and force resets it', async () => {
  const f = fakes();
  for (const id of ['a', 'b']) { await f.deps.store.createNote(note(id)); await f.deps.store.addChunk(chunk(id)); }
  jest.mocked(f.deps.sync.uploadChunk).mockRejectedValueOnce(new Error('HTTP 503'));
  const q = createUploadQueue(f.deps); await q.resume(); await q.resume();
  expect(jest.mocked(f.deps.sync.uploadChunk).mock.calls.map(([c]) => c.noteId)).toEqual(['a', 'b']);
  await q.resume({ force: true });
  expect(f.chunks.get('a/0')?.remotePath).toBeTruthy();
});

test('upload times out after 120s then retries without retaining late upload results', async () => {
  const f = fakes(); await f.deps.store.createNote(note());
  await f.deps.store.addChunk(chunk()); await f.deps.store.addChunk(chunk('note', 1));
  let release!: (path: string) => void;
  jest.mocked(f.deps.sync.uploadChunk).mockImplementationOnce(() => new Promise(r => { release = r; }));
  const q = createUploadQueue(f.deps); const work = q.resume();
  await jest.advanceTimersByTimeAsync(120_000); await work;
  expect(f.chunks.get('note/0')?.remotePath).toBeNull();
  expect(f.chunks.get('note/1')?.remotePath).toBeTruthy();
  release('late'); await Promise.resolve();
  expect(f.chunks.get('note/0')?.remotePath).toBeNull();
  await jest.advanceTimersByTimeAsync(2000);
  expect(f.chunks.get('note/0')?.remotePath).toBe('remote/note/0');
});

test('null local path skips upload without calling the service', async () => {
  const f = fakes(); await f.deps.store.createNote(note()); await f.deps.store.addChunk({ ...chunk(), localPath: null });
  await createUploadQueue(f.deps).resume(); expect(f.deps.sync.uploadChunk).not.toHaveBeenCalled();
});

test('mirrors the note before its uploaded chunk rows and re-pushes only on change', async () => {
  const f = fakes();
  await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  const order: string[] = [];
  jest.mocked(f.deps.sync.pushNote).mockImplementation(async () => { order.push('note'); });
  jest.mocked(f.deps.sync.pushChunks).mockImplementation(async chunks => { order.push(`chunks:${chunks.map(c => c.seq)}`); });
  const queue = createUploadQueue(f.deps);
  await queue.resume();
  expect(order).toEqual(['note', 'chunks:0']);
  await queue.resume();
  expect(order).toHaveLength(2);
  await f.deps.store.updateNote('note', { title: 'renamed' });
  await queue.resume();
  expect(order).toEqual(['note', 'chunks:0', 'note']);
});

test('does not push chunk rows while the note push is failing, and retries it', async () => {
  const f = fakes();
  await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  jest.mocked(f.deps.sync.pushNote).mockRejectedValueOnce(new Error('offline'));
  const queue = createUploadQueue(f.deps);
  await queue.resume();
  expect(f.deps.sync.uploadChunk).toHaveBeenCalledTimes(1);
  expect(f.deps.sync.pushChunks).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2000);
  expect(f.deps.sync.pushNote).toHaveBeenCalledTimes(2);
  expect(f.deps.sync.pushChunks).toHaveBeenCalledTimes(1);
});

test('signed-out sessions push nothing', async () => {
  const f = fakes();
  await f.deps.store.createNote(note());
  jest.mocked(f.deps.isSignedIn).mockResolvedValue(false);
  await createUploadQueue(f.deps).resume();
  expect(f.deps.sync.pushNote).not.toHaveBeenCalled();
});

test('audio uploaded under another account is uploaded again for the signed-in user', async () => {
  const f = fakes();
  await f.deps.store.createNote(note());
  await f.deps.store.addChunk({ ...chunk(), remotePath: 'old-user/note/0.webm', uploadedAt: 'before' });
  await f.deps.store.addChunk({ ...chunk('note', 1), remotePath: 'me/note/1.webm', uploadedAt: 'before' });
  jest.mocked(f.deps.sync.uploadChunk).mockImplementation(async c => `me/${c.noteId}/${c.seq}.webm`);
  await createUploadQueue({ ...f.deps, userId: async () => 'me' }).resume();
  expect(jest.mocked(f.deps.sync.uploadChunk).mock.calls.map(([c]) => c.seq)).toEqual([0]);
  expect(jest.mocked(f.deps.sync.pushChunks).mock.calls.at(-1)?.[0].map(c => c.remotePath)).toEqual(['me/note/0.webm', 'me/note/1.webm']);
});

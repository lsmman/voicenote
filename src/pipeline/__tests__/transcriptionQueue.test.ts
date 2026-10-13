/// <reference types="jest" />
import { createTranscriptionQueue } from '../transcriptionQueue';
import { chunk, fakes, note } from '../testing/fakes';

test('globally serial across notes and concurrent resumes, with per-note seq order and 200 character prompt', async () => {
  const f = fakes();
  for (const id of ['a', 'b']) {
    await f.deps.store.createNote(note(id, 'transcribing'));
    await f.deps.store.addChunk(chunk(id, 1)); await f.deps.store.addChunk(chunk(id, 0));
  }
  let running = 0; let maxRunning = 0; let nextId = 0;
  jest.mocked(f.deps.engine.transcribeChunk).mockImplementation(async () => {
    maxRunning = Math.max(maxRunning, ++running);
    await Promise.resolve(); running--;
    return [{ startMs: 0, endMs: 30_000, text: 'a'.repeat(250) }];
  });
  const progress = jest.fn();
  const queue = createTranscriptionQueue({ ...f.deps, newId: () => String(++nextId), summarize: async id => { await f.deps.store.updateNote(id, { status: 'done' }); }, events: { onSegments: jest.fn(), onProgress: progress, onError: jest.fn() } });
  await Promise.all([queue.resume(), queue.resume()]);
  expect(maxRunning).toBe(1);
  expect(jest.mocked(f.deps.engine.transcribeChunk).mock.calls.map(([c]) => `${c.noteId}/${c.seq}`)).toEqual(['a/0', 'a/1', 'b/0', 'b/1']);
  expect(jest.mocked(f.deps.engine.transcribeChunk).mock.calls[1][1].prompt).toHaveLength(200);
  expect(progress).toHaveBeenCalledWith('a', 2, 2);
});

test('inference failure preserves pending chunk for later retry', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'transcribing')); await f.deps.store.addChunk(chunk('n'));
  jest.mocked(f.deps.engine.transcribeChunk).mockRejectedValueOnce(new Error('engine failed'));
  const error = jest.fn();
  const queue = createTranscriptionQueue({ ...f.deps, newId: () => 'segment', summarize: jest.fn(), events: { onSegments: jest.fn(), onProgress: jest.fn(), onError: error } });
  await queue.resume(); expect(f.chunks.get('n/0')?.transcribedAt).toBeNull(); expect(error).toHaveBeenCalledTimes(1);
  await queue.resume(); expect(f.chunks.get('n/0')?.transcribedAt).not.toBeNull();
});

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

function queueFor(f: ReturnType<typeof fakes>) {
  return createTranscriptionQueue({ ...f.deps, newId: () => 'unused', summarize: jest.fn(), events: { onSegments: jest.fn(), onProgress: jest.fn(), onError: jest.fn() } });
}

test('three inference failures persist a gap and skip to the next chunk', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'transcribing'));
  await f.deps.store.addChunk(chunk('n')); await f.deps.store.addChunk(chunk('n', 1));
  const transcribe = jest.mocked(f.deps.engine.transcribeChunk);
  transcribe.mockImplementation(async c => { if (!c.seq) throw new Error('bad audio'); return [{ startMs: 0, endMs: 1000, text: 'next' }]; });
  const q = queueFor(f);
  await q.resume(); await q.resume();
  expect(f.chunks.get('n/0')?.transcribedAt).toBeNull();
  await q.resume();
  expect(f.notes.get('n')?.gaps).toEqual([{ atMs: 0, reason: 'transcribe-failed' }]);
  expect([...f.chunks.values()].every(c => c.transcribedAt)).toBe(true);
  expect(transcribe.mock.calls.map(([c]) => c.seq)).toEqual([0, 0, 0, 1]);
  await queueFor(f).resume(); expect(transcribe).toHaveBeenCalledTimes(4);
});

test('inference times out after 120s and late results cannot write segments', async () => {
  const f = fakes(); await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  let resolve!: (value: { startMs: number; endMs: number; text: string }[]) => void;
  jest.mocked(f.deps.engine.transcribeChunk).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const q = queueFor(f); const work = q.resume();
  await jest.advanceTimersByTimeAsync(120_000); await work;
  expect(f.chunks.get('note/0')?.transcribedAt).toBeNull();
  await q.resume();
  resolve([{ startMs: 0, endMs: 1000, text: 'late' }]); await Promise.resolve();
  expect((await f.deps.store.listSegments('note')).map(s => s.text)).toEqual(['chunk 0']);
});

test('exclusive operations run between chunks rather than after the drain', async () => {
  const f = fakes(); await f.deps.store.createNote(note());
  await f.deps.store.addChunk(chunk()); await f.deps.store.addChunk(chunk('note', 1));
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(r => { entered = r; });
  const order: string[] = [];
  jest.mocked(f.deps.engine.transcribeChunk).mockImplementation(async c => {
    order.push(`chunk ${c.seq}`);
    if (!c.seq) { entered(); await new Promise<void>(r => { release = r; }); }
    return [];
  });
  const q = queueFor(f); const work = q.resume(); await started;
  const mutation = q.exclusive(async () => { order.push('mutation'); });
  release(); await mutation; await work;
  expect(order).toEqual(['chunk 0', 'mutation', 'chunk 1']);
});

test('missing note model falls back to ready selected model and otherwise stays idle', async () => {
  const f = fakes(); await f.deps.store.createNote({ ...note(), modelName: 'deleted' }); await f.deps.store.addChunk(chunk());
  jest.mocked(f.deps.engine.isModelReady).mockResolvedValue(false);
  const q = queueFor(f); await q.resume();
  expect(f.deps.engine.load).not.toHaveBeenCalled();
  expect(f.notes.get('note')?.status).toBe('recording');
  jest.mocked(f.deps.engine.isModelReady).mockImplementation(async id => id === 'test-model');
  await q.resume();
  expect(f.notes.get('note')?.modelName).toBe('test-model');
  expect(f.deps.engine.load).toHaveBeenCalledWith('test-model');
});

test('retry after partial segment persistence uses stable chunk segment IDs', async () => {
  const f = fakes(); await f.deps.store.createNote(note()); await f.deps.store.addChunk(chunk());
  jest.mocked(f.deps.engine.transcribeChunk).mockResolvedValue([
    { startMs: 0, endMs: 1000, text: 'first' }, { startMs: 1100, endMs: 2000, text: 'second' },
  ]);
  const write = f.deps.store.putSegments;
  jest.spyOn(f.deps.store, 'putSegments').mockImplementationOnce(async (id, segments) => { await write(id, segments.slice(0, 1)); throw new Error('partial write'); });
  const q = queueFor(f); await q.resume(); await q.resume();
  expect((await f.deps.store.listSegments('note')).map(s => s.id)).toEqual(['note:0:0', 'note:0:1']);
});

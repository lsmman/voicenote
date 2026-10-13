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

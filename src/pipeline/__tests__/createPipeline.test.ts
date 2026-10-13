/// <reference types="jest" />
jest.mock('../../core/id', () => {
  let id = 0;
  return { newId: () => `id-${++id}` };
});
import { createPipeline } from '../createPipeline';
import { chunk, fakes, note } from '../testing/fakes';
import type { LiveSessionState } from '../types';

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('journals final flush before stop, transcribes in order, then summarizes with memos', async () => {
  const f = fakes();
  const p = createPipeline(f.deps);
  const states: (LiveSessionState | null)[] = [];
  p.subscribe(s => states.push(s));
  const id = await p.startRecording();
  expect(f.notes.get(id)?.title).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} 녹음$/);
  f.events().onElapsed?.(1234);
  expect(await p.addMemo('important', 'bookmark')).toMatchObject({ atMs: 1234, kind: 'bookmark' });
  f.events().onWarning?.({ kind: 'interrupted', reason: 'phone' });
  f.events().onLevel?.(0.6);
  f.events().onChunk?.(chunk(id, 0));
  await p.resumeQueues();
  expect(f.notes.get(id)?.status).toBe('recording');
  expect(f.deps.sync.summarize).not.toHaveBeenCalled();
  expect(states.at(-1)).toMatchObject({ level: 0.6, pendingChunks: 0, liveSegments: [{ text: 'chunk 0' }] });
  jest.mocked(f.deps.recorder.stop).mockImplementation(async () => { f.events().onChunk?.(chunk(id, 1)); });
  await p.stopRecording();
  await p.resumeQueues();
  expect(jest.mocked(f.deps.engine.transcribeChunk).mock.calls.map(([c]) => c.seq)).toEqual([0, 1]);
  expect(jest.mocked(f.deps.engine.transcribeChunk).mock.calls[1][1]).toMatchObject({ prevChunk: { seq: 0 }, prompt: 'chunk 0', language: 'ko' });
  expect(f.history).toEqual(['recording', 'transcribing', 'summarizing', 'done']);
  expect(f.notes.get(id)).toMatchObject({ durationMs: 60_000, gaps: [{ atMs: 1234, reason: 'phone' }] });
  expect(f.deps.sync.summarize).toHaveBeenCalledWith(expect.objectContaining({ memos: [expect.objectContaining({ atMs: 1234 })] }));
  expect(states.at(-1)).toBeNull();
  expect(f.deps.store.addChunk).toHaveBeenCalledTimes(2);
});

test('missing model leaves recording functional and pending transcription resumable', async () => {
  const f = fakes();
  jest.mocked(f.deps.engine.isModelReady).mockResolvedValue(false);
  const p = createPipeline(f.deps);
  const id = await p.startRecording('no model');
  f.events().onChunk?.(chunk(id));
  await p.stopRecording(); await p.resumeQueues();
  expect(f.notes.get(id)?.status).toBe('transcribing');
  expect(f.deps.engine.load).not.toHaveBeenCalled();
  jest.mocked(f.deps.engine.isModelReady).mockResolvedValue(true);
  await p.resumeQueues(); expect(f.notes.get(id)?.status).toBe('done');
});

test('finds crashed sessions, excludes live session, and recovers saved duration', async () => {
  const f = fakes();
  await f.deps.store.createNote(note('crashed')); await f.deps.store.addChunk(chunk('crashed', 1));
  const p = createPipeline(f.deps);
  const active = await p.startRecording();
  expect((await p.findUnfinished()).map(n => n.id)).toEqual(['crashed']);
  await expect(p.recover(active)).rejects.toThrow('active');
  await p.recover('crashed'); await p.resumeQueues();
  expect(f.notes.get('crashed')).toMatchObject({ durationMs: 60_000, status: 'done' });
});

test('summary failure still finishes; resummarize retries successfully', async () => {
  const f = fakes();
  jest.mocked(f.deps.sync.summarize).mockRejectedValueOnce(new Error('API failed'));
  const p = createPipeline(f.deps);
  const id = await p.importFile('file:///audio.m4a', 'audio.m4a', 'audio/m4a');
  await p.resumeQueues();
  expect(f.notes.get(id)).toMatchObject({ status: 'done', durationMs: 900 });
  expect(f.summaries.has(id)).toBe(false);
  await p.resummarize(id);
  expect(f.summaries.has(id)).toBe(true);
  expect(f.notes.get(id)?.status).toBe('done');
});

test('offline summary waits for foreground; signed-out summary finishes without API call', async () => {
  const f = fakes();
  jest.mocked(f.deps.isOnline).mockResolvedValue(false);
  const p = createPipeline(f.deps);
  const id = await p.importFile('file:///audio.wav', 'audio', 'audio/wav'); await p.resumeQueues();
  expect(f.notes.get(id)?.status).toBe('summarizing');
  expect(f.deps.sync.summarize).not.toHaveBeenCalled();
  jest.mocked(f.deps.isOnline).mockResolvedValue(true);
  await p.resumeQueues(); expect(f.notes.get(id)?.status).toBe('done');
  jest.mocked(f.deps.isSignedIn).mockResolvedValue(false);
  await p.resummarize(id);
  expect(f.deps.sync.summarize).toHaveBeenCalledTimes(1);
  expect(f.notes.get(id)?.status).toBe('done');
});

test('web import persists fetched blob under note/0 before processing', async () => {
  const originalFetch = global.fetch;
  const blob = new Blob(['audio']);
  global.fetch = jest.fn(async () => ({ ok: true, blob: async () => blob })) as unknown as typeof fetch;
  try {
    const f = fakes(); const p = createPipeline(f.deps);
    const id = await p.importFile('blob:test', 'import.webm', 'audio/webm'); await p.resumeQueues();
    expect(f.blobs.get(`${id}/0`)).toBe(blob);
    expect(f.chunks.get(`${id}/0`)).toMatchObject({ localPath: `${id}/0`, durationMs: 900 });
  } finally { global.fetch = originalFetch; }
});

test('retranscribe clears segments and selects requested model', async () => {
  const f = fakes(); const p = createPipeline(f.deps);
  const id = await p.importFile('file:///audio.wav', 'audio', 'audio/wav'); await p.resumeQueues();
  const old = await f.deps.store.listSegments(id);
  await p.retranscribe(id, 'other-model'); await p.resumeQueues();
  expect(f.deps.engine.load).toHaveBeenLastCalledWith('other-model');
  const current = await f.deps.store.listSegments(id);
  expect(current).toHaveLength(1); expect(current[0].id).not.toBe(old[0].id);
  expect(f.notes.get(id)?.status).toBe('done');
});

test('concurrent starts are rejected and pause/resume keeps memo timeline from recorder', async () => {
  const f = fakes(); const p = createPipeline(f.deps);
  const first = p.startRecording(); await expect(p.startRecording()).rejects.toThrow('active'); await first;
  f.events().onElapsed?.(5000); await p.pauseRecording();
  expect((await p.addMemo('paused', 'memo')).atMs).toBe(5000);
  await p.resumeRecording(); f.events().onElapsed?.(5100);
  expect((await p.addMemo('resumed', 'memo')).atMs).toBe(5100);
});

test('journal failure prevents finalization and leaves recording recoverable', async () => {
  const f = fakes(); const p = createPipeline(f.deps);
  const id = await p.startRecording();
  jest.mocked(f.deps.store.addChunk).mockRejectedValueOnce(new Error('disk full'));
  f.events().onChunk?.(chunk(id));
  await expect(p.stopRecording()).rejects.toThrow('disk full');
  expect(f.notes.get(id)?.status).toBe('recording');
  expect(f.deps.sync.summarize).not.toHaveBeenCalled();
});

test('retranscribe waits for in-flight result before clearing it', async () => {
  const f = fakes();
  await f.deps.store.createNote(note('waiting', 'transcribing'));
  await f.deps.store.addChunk(chunk('waiting'));
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  jest.mocked(f.deps.engine.transcribeChunk).mockImplementationOnce(async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
    return [{ startMs: 0, endMs: 1000, text: 'old result' }];
  });
  const p = createPipeline(f.deps);
  const work = p.resumeQueues(); await started;
  const reset = p.retranscribe('waiting', 'replacement'); release();
  await work; await reset; await p.resumeQueues();
  expect((await f.deps.store.listSegments('waiting')).map(s => s.text)).toEqual(['chunk 0']);
  expect(f.deps.engine.load).toHaveBeenLastCalledWith('replacement');
});

test('foreground resume cannot summarize a web import before its blob is journaled', async () => {
  const originalFetch = global.fetch;
  let release!: () => void; let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  global.fetch = jest.fn(async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
    return { ok: true, blob: async () => new Blob(['audio']) };
  }) as unknown as typeof fetch;
  try {
    const f = fakes(); const p = createPipeline(f.deps);
    const importing = p.importFile('blob:slow', 'slow', 'audio/webm');
    await started; const resumed = p.resumeQueues();
    expect(f.deps.sync.summarize).not.toHaveBeenCalled(); release();
    const id = await importing; await resumed; await p.resumeQueues();
    expect(f.notes.get(id)?.status).toBe('done');
    expect(f.deps.sync.summarize).toHaveBeenCalledWith(expect.objectContaining({ segments: [expect.objectContaining({ text: 'chunk 0' })] }));
  } finally { global.fetch = originalFetch; }
});

/// <reference types="jest" />
jest.mock('../../core/id', () => {
  let id = 0;
  return { newId: () => `id-${++id}` };
});
jest.mock('../localFile', () => ({
  prepareImportedAudio: jest.fn(async (uri: string, _name: string, noteId: string, store: import('../../store/types').LocalStore) => {
    if (uri.startsWith('blob:')) {
      const response = await fetch(uri);
      await store.putAudioBlob!(`${noteId}/0`, await response.blob());
    }
    return { localPath: `${noteId}/0`, durationMs: 900 };
  }),
}));
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
  expect(current).toHaveLength(1); expect(current[0].id).toBe(old[0].id);
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

test('journal failure finalizes with a gap and retries with backoff', async () => {
  const f = fakes(); const p = createPipeline(f.deps);
  const id = await p.startRecording();
  jest.mocked(f.deps.store.addChunk).mockRejectedValueOnce(new Error('disk full'));
  f.events().onChunk?.(chunk(id));
  await p.stopRecording();
  expect(f.notes.get(id)).toMatchObject({ status: 'transcribing', gaps: [{ atMs: 0, reason: 'journal-failed' }] });
  expect(f.deps.sync.summarize).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(2000);
  await p.resumeQueues();
  expect(f.chunks.has(`${id}/0`)).toBe(true);
  expect(f.notes.get(id)?.status).toBe('done');
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

test('persistent journal failures never strand live or prevent stopping', async () => {
  const f = fakes(); const p = createPipeline(f.deps); const listener = jest.fn(); p.subscribe(listener);
  const id = await p.startRecording();
  jest.mocked(f.deps.store.addChunk).mockRejectedValue(new Error('disk full'));
  f.events().onChunk?.(chunk(id)); await p.stopRecording();
  expect(listener).toHaveBeenLastCalledWith(null);
  expect(f.notes.get(id)).toMatchObject({ status: 'transcribing', gaps: [{ atMs: 0, reason: 'journal-failed' }] });
  await jest.advanceTimersByTimeAsync(1999); expect(f.deps.store.addChunk).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); expect(f.deps.store.addChunk).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(3999); expect(f.deps.store.addChunk).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(1); expect(f.deps.store.addChunk).toHaveBeenCalledTimes(3);
  await expect(p.startRecording()).resolves.toBeTruthy();
});

test('start failure stops recorder and clears live even if recovery store access fails', async () => {
  const f = fakes(); const p = createPipeline(f.deps); const listener = jest.fn(); p.subscribe(listener);
  jest.mocked(f.deps.recorder.start).mockRejectedValueOnce(new Error('start failed'));
  jest.spyOn(f.deps.store, 'listChunks').mockRejectedValueOnce(new Error('store failed'));
  await expect(p.startRecording()).rejects.toThrow('start failed');
  expect(f.deps.recorder.stop).toHaveBeenCalled(); expect(listener).toHaveBeenLastCalledWith(null);
  await expect(p.startRecording()).resolves.toBeTruthy();
});

test('stop failure leaves a gap and clears live', async () => {
  const f = fakes(); const p = createPipeline(f.deps); const listener = jest.fn(); p.subscribe(listener);
  const id = await p.startRecording();
  jest.mocked(f.deps.recorder.stop).mockRejectedValueOnce(new Error('stop failed'));
  await p.stopRecording();
  expect(f.notes.get(id)?.gaps).toContainEqual({ atMs: 0, reason: 'recorder-stop-failed' });
  expect(listener).toHaveBeenLastCalledWith(null);
  await expect(p.startRecording()).resolves.toBeTruthy();
});

test('retranscribe rejects remote-only audio before changing status segments or flags', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'done'));
  await f.deps.store.addChunk({ ...chunk('n'), localPath: null, remotePath: 'remote', transcribedAt: 'before' });
  const update = jest.spyOn(f.deps.store, 'updateNote'); const replace = jest.spyOn(f.deps.store, 'replaceSegments');
  await expect(createPipeline(f.deps).retranscribe('n', 'new')).rejects.toThrow('원본 오디오가 이 기기에 없어 다시 전사할 수 없어요');
  expect(update).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
  expect(f.chunks.get('n/0')?.transcribedAt).toBe('before');
});

test('retranscribe marks transcribing before clearing data and never automatically cleans audio', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'done'));
  await f.deps.store.addChunk({ ...chunk('n'), transcribedAt: 'before' });
  jest.spyOn(f.deps.store, 'replaceSegments').mockImplementation(async () => { expect(f.notes.get('n')?.status).toBe('transcribing'); });
  const p = createPipeline(f.deps); await p.retranscribe('n', 'new'); await p.resumeQueues();
  expect(f.chunks.get('n/0')?.localPath).toBe('n/0');
  expect(f.deps.store.deleteAudioBlob).not.toHaveBeenCalled();
});

test('import creates recording then journals one measured chunk before transcribing', async () => {
  const f = fakes(); const original = jest.mocked(f.deps.store.addChunk).getMockImplementation()!;
  jest.spyOn(f.deps.store, 'addChunk').mockImplementation(async c => {
    expect(f.notes.get(c.noteId)?.status).toBe('recording');
    expect(c.durationMs).toBe(900); await original(c);
  });
  const id = await createPipeline(f.deps).importFile('file:///picked.mp3', 'picked.mp3', 'audio/mpeg');
  expect(f.history.slice(0, 2)).toEqual(['recording', 'transcribing']);
  expect(await f.deps.store.listChunks(id)).toHaveLength(1);
});

test('summary failure survives pipeline restart as done with no summary', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'done'));
  jest.mocked(f.deps.sync.summarize).mockRejectedValueOnce(new Error('offline'));
  await createPipeline(f.deps).resumeQueues();
  expect(f.notes.get('n')?.status).toBe('done'); expect(f.summaries.has('n')).toBe(false);
  await createPipeline(f.deps).resumeQueues();
  expect(f.summaries.has('n')).toBe(true); expect(f.deps.sync.summarize).toHaveBeenCalledTimes(2);
});

test('summary times out at 280s without blocking transcription or import', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'summarizing'));
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  jest.mocked(f.deps.sync.summarize).mockImplementationOnce(() => { entered(); return new Promise(() => {}); });
  const p = createPipeline(f.deps); const work = p.resumeQueues(); await started;
  const id = await p.importFile('file:///other.wav', 'other', 'audio/wav');
  await jest.advanceTimersByTimeAsync(0);
  expect(f.chunks.get(`${id}/0`)?.transcribedAt).toBeTruthy();
  await jest.advanceTimersByTimeAsync(280_000); await work;
  expect(f.notes.get('n')?.status).toBe('done'); expect(f.summaries.has('n')).toBe(false);
  await p.resumeQueues(); expect(f.summaries.has('n')).toBe(true);
});

test('level-only notifications are capped at four per second and warnings at twenty', async () => {
  const f = fakes(); const p = createPipeline(f.deps); const listener = jest.fn(); p.subscribe(listener);
  await p.startRecording(); listener.mockClear();
  for (let i = 0; i < 20; i++) { f.events().onLevel?.(i / 20); await jest.advanceTimersByTimeAsync(50); }
  expect(listener).toHaveBeenCalledTimes(4);
  for (let i = 0; i < 25; i++) f.events().onWarning?.({ kind: 'silence', forMs: i });
  const warnings = listener.mock.calls.at(-1)![0].warnings;
  expect(warnings).toHaveLength(20); expect(warnings[0].forMs).toBe(5); expect(warnings[19].forMs).toBe(24);
});

test('memo interpolates recording elapsed time and freezes during pause', async () => {
  const f = fakes(); const p = createPipeline(f.deps); await p.startRecording(); f.events().onElapsed?.(5000);
  await jest.advanceTimersByTimeAsync(345);
  expect((await p.addMemo('between ticks', 'memo')).atMs).toBe(5345);
  await p.pauseRecording(); await jest.advanceTimersByTimeAsync(5000);
  expect((await p.addMemo('paused', 'memo')).atMs).toBe(5345);
  await p.resumeRecording(); await jest.advanceTimersByTimeAsync(123);
  expect((await p.addMemo('resumed', 'memo')).atMs).toBe(5468);
});

test('memo prefers synchronous recorder elapsed getter', async () => {
  const f = fakes(); Object.assign(f.deps.recorder, { getElapsedMs: () => 4321 });
  const p = createPipeline(f.deps); await p.startRecording(); f.events().onElapsed?.(1000);
  await jest.advanceTimersByTimeAsync(200);
  expect((await p.addMemo('precise', 'bookmark')).atMs).toBe(4321);
});

test('late summary cannot mark a retranscribing note done', async () => {
  const f = fakes(); await f.deps.store.createNote(note('n', 'summarizing'));
  await f.deps.store.addChunk({ ...chunk('n'), transcribedAt: 'before' });
  let release!: (value: { summary: []; keywords: []; todos: [] }) => void;
  let entered!: () => void; const started = new Promise<void>(r => { entered = r; });
  jest.mocked(f.deps.sync.summarize).mockImplementationOnce(() => { entered(); return new Promise(r => { release = r; }); });
  const p = createPipeline(f.deps); const work = p.resumeQueues(); await started;
  jest.mocked(f.deps.engine.isModelReady).mockResolvedValue(false);
  await p.retranscribe('n', 'missing');
  release({ summary: [], keywords: [], todos: [] }); await work;
  expect(f.notes.get('n')?.status).toBe('transcribing'); expect(f.summaries.has('n')).toBe(false);
});

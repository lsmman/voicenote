import { newId } from '../core/id';
import type { AudioChunk, Memo, Note } from '../core/types';
import type { LocalStore } from '../store/types';
import type { Recorder } from '../recorder/types';
import type { TranscriberEngine } from '../transcriber/types';
import type { SyncService } from '../sync/types';
import type { LiveSessionState, Pipeline } from './types';
import { createUploadQueue } from './uploadQueue';
import { createTranscriptionQueue } from './transcriptionQueue';
import { prepareImportedAudio } from './localFile';
import { withTimeout } from './timeout';
import { createJournal } from './journal';
import { createModelDownload } from './modelDownload';

export interface PipelineDeps {
  store: LocalStore;
  recorder: Recorder;
  engine: TranscriberEngine;
  sync: SyncService;
  getModelId(): Promise<string>;
  isOnline(): Promise<boolean>;
  getNetworkType(): Promise<'wifi' | 'cellular' | 'none' | 'unknown'>;
  platform: 'web' | 'native';
  now(): number;
  isSignedIn(): Promise<boolean>;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { store, recorder } = deps;
  let live: LiveSessionState | null = null;
  let starting = false;
  let stopping: Promise<void> | undefined;
  let lastElapsedAt = deps.now();
  let lastLevelNotification = -Infinity;
  const listeners = new Set<(state: LiveSessionState | null) => void>();
  const progressListeners = new Set<(noteId: string, done: number, total: number) => void>();
  // The fixed Note/Summary contracts have no error field. Missing summary remains
  // the durable retry signal after restart; this map also remembers failed refreshes.
  const summaryFailures = new Map<string, unknown>();
  const summaries = new Map<string, Promise<void>>();
  const summaryVersions = new Map<string, number>();
  const notify = (levelOnly = false) => {
    if (levelOnly && deps.now() - lastLevelNotification < 250) return;
    if (levelOnly) lastLevelNotification = deps.now();
    for (const listener of listeners) {
      try { listener(live ? { ...live, warnings: [...live.warnings], liveSegments: [...live.liveSegments], memos: [...live.memos] } : null); }
      catch { /* A view listener must not interrupt persistence or recording. */ }
    }
  };

  function summarize(noteId: string): Promise<void> {
    const pending = summaries.get(noteId);
    if (pending) return pending;
    const version = summaryVersions.get(noteId) ?? 0;
    const currentVersion = () => (summaryVersions.get(noteId) ?? 0) === version;
    const result = (async () => {
      const note = await store.getNote(noteId);
      if (!note) throw new Error('Note not found');
      if (!['done', 'summarizing'].includes(note.status)) return;
      try {
        // Keep summarizing while offline; foreground resume retries automatically.
        if (!await deps.isOnline()) return;
        const response = await withTimeout(deps.sync.summarize({
          noteId, title: note.title,
          segments: await store.listSegments(noteId), memos: await store.listMemos(noteId),
        }), 280_000);
        if (!currentVersion()) return;
        await store.putSummary({ ...response, noteId, createdAt: new Date(deps.now()).toISOString() });
        summaryFailures.delete(noteId);
      } catch (error) {
        if (currentVersion()) summaryFailures.set(noteId, error);
      }
      if (currentVersion()) await store.updateNote(noteId, { status: 'done' });
    })().finally(() => { if (summaries.get(noteId) === result) summaries.delete(noteId); });
    summaries.set(noteId, result);
    return result;
  }

  const model = createModelDownload(deps, kick);
  const uploads = createUploadQueue(deps);
  const transcription = createTranscriptionQueue({
    ...deps, newId, summarize,
    ensureModel: model.ensureModel,
    hasPendingJournal: noteId => journal.pending(noteId).length > 0,
    events: {
      onSegments(noteId, segments) {
        if (live?.noteId === noteId) { live.liveSegments = segments; notify(); }
      },
      onProgress(noteId, done, total) {
        if (live?.noteId === noteId) { live.pendingChunks = total - done; notify(); }
        for (const listener of progressListeners) {
          try { listener(noteId, done, total); } catch { /* View errors do not fail jobs. */ }
        }
      },
      onError() { /* Leave unprocessed chunks pending for foreground resume. */ },
    },
  });
  function kick() {
    void uploads.resume().catch(() => undefined);
    void transcription.resume().catch(() => undefined);
  }
  const journal = createJournal(deps.now, async noteId => {
    const note = await store.getNote(noteId);
    // A late journal retry invalidates a previously completed transcript/summary.
    if (note && ['done', 'summarizing'].includes(note.status)) {
      await store.updateNote(noteId, { status: 'transcribing' });
    }
    kick();
  });
  function elapsed(session: LiveSessionState): number {
    const precise = (recorder as Recorder & { getElapsedMs?(): number }).getElapsedMs?.();
    return precise ?? session.elapsedMs + (session.state === 'recording' ? Math.max(0, deps.now() - lastElapsedAt) : 0);
  }
  async function requireNote(noteId: string) {
    const note = await store.getNote(noteId);
    if (!note) throw new Error('Note not found');
    return note;
  }
  function requireLive() {
    if (!live || starting || stopping) throw new Error('No active recording');
    return live;
  }
  function makeNote(title: string, status: Note['status']): Note {
    return { id: newId(), userId: null, title, createdAt: new Date(deps.now()).toISOString(), durationMs: 0, status, modelName: null, gaps: [] };
  }
  const chunkEnd = (chunks: AudioChunk[]) => Math.max(0, ...chunks.map(chunk => chunk.startMs + chunk.durationMs));

  const pipeline: Pipeline = {
    onModelState: model.subscribe,
    downloadModelNow: () => model.ensureModel(true),
    async startRecording(title) {
      if (live || starting || stopping) throw new Error('Recording already active');
      starting = true;
      void model.ensureModel();
      const date = new Date(deps.now());
      const pad = (value: number) => String(value).padStart(2, '0');
      const defaultTitle = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} 녹음`;
      const note = makeNote(title ?? defaultTitle, 'recording');
      try {
        await store.createNote(note);
        lastElapsedAt = deps.now(); lastLevelNotification = -Infinity;
        live = { noteId: note.id, state: 'idle', elapsedMs: 0, level: 0, warnings: [], liveSegments: [], memos: [], pendingChunks: 0 };
        notify();
        await recorder.start(note.id, {
          onChunk(chunk) {
            journal.add(note.id, chunk.startMs, async () => {
              if (chunk.noteId !== note.id) throw new Error('Recorder chunk belongs to another note');
              await store.addChunk(chunk);
              if (live?.noteId === note.id) { live.pendingChunks += 1; notify(); }
              kick();
            });
          },
          onElapsed(ms) { if (live?.noteId === note.id) { live.elapsedMs = ms; lastElapsedAt = deps.now(); notify(); } },
          onLevel(level) { if (live?.noteId === note.id) { live.level = level; notify(true); } },
          onStateChange(state) {
            if (live?.noteId !== note.id) return;
            if (live.state === 'recording') live.elapsedMs = elapsed(live);
            live.state = state; lastElapsedAt = deps.now(); notify();
          },
          onWarning(warning) {
            if (live?.noteId !== note.id) return;
            live.warnings = [...live.warnings, warning].slice(-20);
            const atMs = elapsed(live);
            if (warning.kind === 'interrupted') journal.add(note.id, atMs, async () => {
              const current = await requireNote(note.id);
              await store.updateNote(note.id, { gaps: [...current.gaps, { atMs, reason: warning.reason }] });
            });
            notify();
          },
        });
        live.state = recorder.getState(); notify();
        return note.id;
      } catch (error) {
        try {
          await withTimeout(recorder.stop(), 120_000);
        } catch { /* Best effort: start may have partially acquired the microphone. */ }
        try {
          await journal.flush();
          if ((await store.listChunks(note.id)).length === 0 && !journal.pending(note.id).length && await store.getNote(note.id)) {
            await store.updateNote(note.id, { status: 'error' });
          }
        } catch { /* Preserve the original start failure. */ }
        finally { live = null; notify(); }
        throw error;
      } finally { starting = false; }
    },
    async pauseRecording() { requireLive(); await recorder.pause(); if (live) live.state = recorder.getState(); notify(); },
    async resumeRecording() { requireLive(); await recorder.resume(); if (live) live.state = recorder.getState(); notify(); },
    stopRecording() {
      if (stopping) return stopping;
      if (!live || starting) return Promise.reject(new Error('No active recording'));
      const session = live;
      stopping = (async () => {
        let stopFailed = false;
        try { await withTimeout(recorder.stop(), 120_000); }
        catch { stopFailed = true; }
        try { await withTimeout(journal.flush(), 120_000); }
        catch { /* Pending writes remain queued and are represented by gaps below. */ }
        const note = await requireNote(session.noteId);
        const gaps = journal.pending(session.noteId).map(item => ({ atMs: item.atMs, reason: 'journal-failed' }));
        if (stopFailed) gaps.push({ atMs: session.elapsedMs, reason: 'recorder-stop-failed' });
        await store.updateNote(session.noteId, {
          durationMs: Math.max(note.durationMs, session.elapsedMs, chunkEnd(await store.listChunks(session.noteId))),
          status: 'transcribing', gaps: [...note.gaps, ...gaps],
        });
        kick();
      })().finally(() => { live = null; stopping = undefined; notify(); });
      return stopping;
    },
    async addMemo(text, kind) {
      const session = requireLive();
      const memo: Memo = { id: newId(), noteId: session.noteId, atMs: elapsed(session), text, kind };
      await store.addMemo(memo);
      if (live === session) { live.memos.push(memo); notify(); }
      return memo;
    },
    subscribe(listener) { listeners.add(listener); notify(); return () => { listeners.delete(listener); }; },
    async importFile(uri, name, mimeType) {
      void model.ensureModel();
      const note = makeNote(name, 'recording');
      await store.createNote(note);
      try {
        const { localPath, durationMs } = await prepareImportedAudio(uri, name, note.id, store);
        // ONE chunk: compressed files cannot be split without decoding; engines window internally.
        await store.addChunk({ noteId: note.id, seq: 0, startMs: 0, durationMs, localPath, mimeType, remotePath: null, uploadedAt: null, transcribedAt: null });
        await store.updateNote(note.id, { status: 'transcribing', durationMs });
      } catch (error) {
        await store.updateNote(note.id, { status: 'error' });
        throw error;
      }
      kick(); return note.id;
    },
    async findUnfinished() { return (await store.listNotes()).filter(note => note.status === 'recording' && note.id !== live?.noteId); },
    async recover(noteId) {
      void model.ensureModel();
      if (live?.noteId === noteId) throw new Error('Cannot recover an active recording');
      const note = await requireNote(noteId);
      if (note.status !== 'recording') throw new Error('Note is not an unfinished recording');
      await store.updateNote(noteId, { durationMs: chunkEnd(await store.listChunks(noteId)), status: 'transcribing' });
      kick();
    },
    async resumeQueues() {
      await journal.flush();
      // Only fetch a model when a note is actually waiting for transcription;
      // a first visit with no notes must not start a large download.
      const pending = (await store.listNotes()).some(n => n.status === 'recording' || n.status === 'transcribing');
      if (pending) void model.ensureModel();
      // Snapshot durable retry candidates before draining, so a failure is retried
      // on the next resume, not immediately in a tight loop.
      const retryIds = (await store.listNotes()).filter(n => n.status === 'done').map(n => n.id);
      const retrySummaries = (async () => {
        if (!await deps.isOnline()) return;
        await Promise.all(retryIds.map(async id => {
          if (!await store.getSummary(id) || summaryFailures.has(id)) await summarize(id);
        }));
      })();
      await Promise.all([uploads.resume(true), transcription.resume(), retrySummaries]);
    },
    onNoteProgress(listener) { progressListeners.add(listener); return () => { progressListeners.delete(listener); }; },
    async retranscribe(noteId, modelId) {
      if (live?.noteId === noteId) throw new Error('Cannot retranscribe an active recording');
      await transcription.exclusive(async () => {
        await requireNote(noteId);
        const chunks = await store.listChunks(noteId);
        if (!chunks.length || chunks.some(chunk => !chunk.localPath)) {
          throw new Error('원본 오디오가 이 기기에 없어 다시 전사할 수 없어요');
        }
        summaryVersions.set(noteId, (summaryVersions.get(noteId) ?? 0) + 1);
        summaries.delete(noteId);
        await store.updateNote(noteId, { modelName: modelId, status: 'transcribing' });
        await store.replaceSegments(noteId, []);
        for (const chunk of chunks) await store.updateChunk(noteId, chunk.seq, { transcribedAt: null });
      });
      kick();
    },
    async resummarize(noteId) {
      await transcription.exclusive(async () => {
        const note = await requireNote(noteId);
        if (!['done', 'summarizing'].includes(note.status)) throw new Error('Transcription must finish before summarizing');
        await store.updateNote(noteId, { status: 'summarizing' });
      });
      await summarize(noteId);
      if (summaryFailures.has(noteId)) throw summaryFailures.get(noteId);
    },
  };
  return pipeline;
}

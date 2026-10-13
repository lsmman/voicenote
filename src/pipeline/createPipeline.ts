import { newId } from '../core/id';
import type { AudioChunk, Memo, Note } from '../core/types';
import type { LocalStore } from '../store/types';
import type { Recorder } from '../recorder/types';
import type { TranscriberEngine } from '../transcriber/types';
import type { SyncService } from '../sync/types';
import type { LiveSessionState, Pipeline } from './types';
import { createUploadQueue } from './uploadQueue';
import { createTranscriptionQueue } from './transcriptionQueue';

export interface PipelineDeps {
  store: LocalStore;
  recorder: Recorder;
  engine: TranscriberEngine;
  sync: SyncService;
  getModelId(): Promise<string>;
  isOnline(): Promise<boolean>;
  now(): number;
  isSignedIn(): Promise<boolean>;
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { store, recorder } = deps;
  let live: LiveSessionState | null = null;
  let starting = false;
  let stopping: Promise<void> | undefined;
  let journal = Promise.resolve();
  let journalError: unknown;
  const listeners = new Set<(state: LiveSessionState | null) => void>();
  const progressListeners = new Set<(noteId: string, done: number, total: number) => void>();
  // The fixed Note/Summary contracts have no error field. Missing summary remains
  // the durable retry signal after restart; this set also remembers failed refreshes.
  const summaryFailures = new Set<string>();
  const summaries = new Map<string, Promise<void>>();
  const notify = () => {
    for (const listener of listeners) {
      try { listener(live ? { ...live, warnings: [...live.warnings], liveSegments: [...live.liveSegments], memos: [...live.memos] } : null); }
      catch { /* A view listener must not interrupt persistence or recording. */ }
    }
  };

  function summarize(noteId: string): Promise<void> {
    const pending = summaries.get(noteId);
    if (pending) return pending;
    const result = (async () => {
      const note = await store.getNote(noteId);
      if (!note) throw new Error('Note not found');
      try {
        if (!await deps.isSignedIn()) {
          await store.updateNote(noteId, { status: 'done' });
          return;
        }
        // Keep summarizing while offline; foreground resume retries automatically.
        if (!await deps.isOnline()) return;
        const response = await deps.sync.summarize({
          noteId, title: note.title,
          segments: await store.listSegments(noteId), memos: await store.listMemos(noteId),
        });
        await store.putSummary({ ...response, noteId, createdAt: new Date(deps.now()).toISOString() });
        summaryFailures.delete(noteId);
      } catch {
        summaryFailures.add(noteId);
      }
      await store.updateNote(noteId, { status: 'done' });
    })().finally(() => { summaries.delete(noteId); });
    summaries.set(noteId, result);
    return result;
  }

  const uploads = createUploadQueue(deps);
  const transcription = createTranscriptionQueue({
    ...deps, newId, summarize,
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
  function persist(operation: () => Promise<void>) {
    journal = journal.then(operation).catch(error => { journalError ??= error; });
  }
  async function flushJournal() {
    await journal;
    if (journalError) throw journalError;
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
    async startRecording(title) {
      if (live || starting || stopping) throw new Error('Recording already active');
      starting = true;
      const date = new Date(deps.now());
      const pad = (value: number) => String(value).padStart(2, '0');
      const defaultTitle = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())} 녹음`;
      const note = makeNote(title ?? defaultTitle, 'recording');
      try {
        await store.createNote(note);
        journal = Promise.resolve(); journalError = undefined;
        live = { noteId: note.id, state: 'idle', elapsedMs: 0, level: 0, warnings: [], liveSegments: [], memos: [], pendingChunks: 0 };
        notify();
        await recorder.start(note.id, {
          onChunk(chunk) {
            persist(async () => {
              if (chunk.noteId !== note.id) throw new Error('Recorder chunk belongs to another note');
              await store.addChunk(chunk);
              if (live?.noteId === note.id) { live.pendingChunks += 1; notify(); }
              kick();
            });
          },
          onElapsed(ms) { if (live?.noteId === note.id) { live.elapsedMs = ms; notify(); } },
          onLevel(level) { if (live?.noteId === note.id) { live.level = level; notify(); } },
          onStateChange(state) { if (live?.noteId === note.id) { live.state = state; notify(); } },
          onWarning(warning) {
            if (live?.noteId !== note.id) return;
            live.warnings.push(warning);
            const atMs = live.elapsedMs;
            if (warning.kind === 'interrupted') persist(async () => {
              const current = await requireNote(note.id);
              await store.updateNote(note.id, { gaps: [...current.gaps, { atMs, reason: warning.reason }] });
            });
            notify();
          },
        });
        live.state = recorder.getState(); notify();
        return note.id;
      } catch (error) {
        // Preserve a recording journal for recovery if the recorder emitted audio.
        await journal;
        if ((await store.listChunks(note.id)).length === 0 && await store.getNote(note.id)) {
          await store.updateNote(note.id, { status: 'error' });
        }
        live = null; notify();
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
        await recorder.stop();
        // stop() emits its final chunk synchronously through the void callback;
        // explicitly await the pipeline's asynchronous journal before finalizing.
        await flushJournal();
        const note = await requireNote(session.noteId);
        await store.updateNote(session.noteId, {
          durationMs: Math.max(note.durationMs, session.elapsedMs, chunkEnd(await store.listChunks(session.noteId))),
          status: 'transcribing',
        });
        live = null; notify(); kick();
      })().finally(() => { stopping = undefined; });
      return stopping;
    },
    async addMemo(text, kind) {
      const session = requireLive();
      const memo: Memo = { id: newId(), noteId: session.noteId, atMs: session.elapsedMs, text, kind };
      await store.addMemo(memo);
      if (live === session) { live.memos.push(memo); notify(); }
      return memo;
    },
    subscribe(listener) { listeners.add(listener); notify(); return () => { listeners.delete(listener); }; },
    async importFile(uri, name, mimeType) {
      const note = makeNote(name, 'transcribing');
      // Keep an empty importing note invisible to the transcription drain until
      // its chunk is journaled, including while a web blob fetch is pending.
      await transcription.exclusive(async () => {
        await store.createNote(note);
        try {
          let localPath = uri;
          if (uri.startsWith('blob:')) {
            if (!store.putAudioBlob) throw new Error('Audio blob storage unavailable');
            const response = await fetch(uri);
            if (!response.ok) throw new Error('Could not read imported audio');
            localPath = `${note.id}/0`;
            await store.putAudioBlob(localPath, await response.blob());
          }
          await store.addChunk({ noteId: note.id, seq: 0, startMs: 0, durationMs: 0, localPath, mimeType, remotePath: null, uploadedAt: null, transcribedAt: null });
        } catch (error) {
          await store.updateNote(note.id, { status: 'error' });
          throw error;
        }
      });
      kick(); return note.id;
    },
    async findUnfinished() { return (await store.listNotes()).filter(note => note.status === 'recording' && note.id !== live?.noteId); },
    async recover(noteId) {
      if (live?.noteId === noteId) throw new Error('Cannot recover an active recording');
      const note = await requireNote(noteId);
      if (note.status !== 'recording') throw new Error('Note is not an unfinished recording');
      await store.updateNote(noteId, { durationMs: chunkEnd(await store.listChunks(noteId)), status: 'transcribing' });
      kick();
    },
    async resumeQueues() { await flushJournal(); await Promise.all([uploads.resume(), transcription.resume()]); },
    onNoteProgress(listener) { progressListeners.add(listener); return () => { progressListeners.delete(listener); }; },
    async retranscribe(noteId, modelId) {
      if (live?.noteId === noteId) throw new Error('Cannot retranscribe an active recording');
      await transcription.exclusive(async () => {
        await requireNote(noteId);
        for (const chunk of await store.listChunks(noteId)) await store.updateChunk(noteId, chunk.seq, { transcribedAt: null });
        await store.replaceSegments(noteId, []);
        await store.updateNote(noteId, { modelName: modelId, status: 'transcribing' });
      });
      kick();
    },
    async resummarize(noteId) {
      await transcription.exclusive(async () => {
        const note = await requireNote(noteId);
        if (!['done', 'summarizing'].includes(note.status)) throw new Error('Transcription must finish before summarizing');
        await store.updateNote(noteId, { status: 'summarizing' });
        await summarize(noteId);
      });
    },
  };
  return pipeline;
}

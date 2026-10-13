import type { LocalStore } from '../store/types';
import type { TranscriberEngine, TranscriptionQueueEvents } from '../transcriber/types';
import { mergeSegments } from './mergeSegments';
import { withTimeout } from './timeout';

export function createTranscriptionQueue(deps: {
  store: LocalStore; engine: TranscriberEngine; getModelId(): Promise<string>;
  now(): number; newId(): string; summarize(noteId: string): Promise<void>;
  events: TranscriptionQueueEvents;
  ensureModel?(): Promise<void>;
  hasPendingJournal?(noteId: string): boolean;
}) {
  // Reset operations wait for at most one chunk, never a whole recording/summary.
  let tail: Promise<unknown> = Promise.resolve();
  let active: Promise<void> | undefined;
  let requested = false;
  let completion: Promise<void> | undefined;
  const failures = new Map<string, number>();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }
  async function step(noteId: string): Promise<'next' | 'idle' | 'summary'> {
    const note = await deps.store.getNote(noteId);
    if (!note) return 'idle';
    const chunks = (await deps.store.listChunks(noteId)).sort((a, b) => a.seq - b.seq);
    deps.events.onProgress(noteId, chunks.filter(c => c.transcribedAt !== null).length, chunks.length);
    if (!['recording', 'transcribing', 'summarizing'].includes(note.status)) return 'idle';
    const index = chunks.findIndex(c => c.transcribedAt === null);
    if (index < 0) {
      if (deps.hasPendingJournal?.(noteId)) return 'idle';
      if (note.status === 'transcribing') await deps.store.updateNote(noteId, { status: 'summarizing' });
      return note.status === 'recording' ? 'idle' : 'summary';
    }
    if (note.status === 'summarizing') return 'idle';
    let modelId = note.modelName ?? await deps.getModelId();
    if (!await deps.engine.isModelReady(modelId)) {
      modelId = await deps.getModelId();
      if (!await deps.engine.isModelReady(modelId)) {
        void deps.ensureModel?.();
        return 'idle';
      }
    }
    await deps.engine.load(modelId);
    if (modelId !== note.modelName) await deps.store.updateNote(noteId, { modelName: modelId });
    const chunk = chunks[index];
    const key = `${noteId}:${chunk.seq}`;
    const existing = await deps.store.listSegments(noteId);
    // Count inference failures only: failed persistence must retry the same stable IDs.
    let incoming;
    try {
      incoming = await withTimeout(deps.engine.transcribeChunk(chunk, {
        prevChunk: index > 0 ? chunks[index - 1] : undefined,
        prompt: existing[existing.length - 1]?.text.slice(-200), language: 'ko',
      }), 120_000);
    } catch (error) {
      const count = (failures.get(key) ?? 0) + 1;
      failures.set(key, count);
      deps.events.onError(noteId, error instanceof Error ? error : new Error(String(error)));
      if (count < 3) return 'idle';
      const current = await deps.store.getNote(noteId);
      if (current && !current.gaps.some(g => g.atMs === chunk.startMs && g.reason === 'transcribe-failed')) {
        await deps.store.updateNote(noteId, { gaps: [...current.gaps, { atMs: chunk.startMs, reason: 'transcribe-failed' }] });
      }
      await deps.store.updateChunk(noteId, chunk.seq, { transcribedAt: new Date(deps.now()).toISOString() });
      failures.delete(key);
      return 'next';
    }
    failures.delete(key);
    const merged = mergeSegments(existing, incoming, chunk.startMs, noteId, deps.newId, chunk.seq);
    // New segments plus any existing tail that the boundary merge rewrote (upsert by id).
    await deps.store.putSegments(noteId, merged.filter((segment, i) => i >= existing.length || segment !== existing[i]));
    const durationMs = chunk.durationMs || Math.max(0, ...incoming.map(segment => segment.endMs));
    await deps.store.updateChunk(noteId, chunk.seq, { transcribedAt: new Date(deps.now()).toISOString(), durationMs });
    const current = await deps.store.getNote(noteId);
    if (current) await deps.store.updateNote(noteId, {
      durationMs: Math.max(current.durationMs, chunk.startMs + durationMs, merged[merged.length - 1]?.endMs ?? 0),
    });
    deps.events.onSegments(noteId, await deps.store.listSegments(noteId));
    return 'next';
  }
  async function drain() {
    const summaries: Promise<void>[] = [];
    const scheduled = new Set<string>();
    do {
      requested = false;
      const notes = (await deps.store.listNotes()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const note of notes) {
        try {
          let result;
          do { result = await exclusive(() => step(note.id)); } while (result === 'next');
          if (result === 'summary' && !scheduled.has(note.id)) {
            scheduled.add(note.id);
            summaries.push(deps.summarize(note.id).catch(error => {
              deps.events.onError(note.id, error instanceof Error ? error : new Error(String(error)));
            }));
          }
        } catch (error) {
          deps.events.onError(note.id, error instanceof Error ? error : new Error(String(error)));
        }
      }
    } while (requested);
    // Summary network requests run outside both the chunk lock and the active drain.
    return summaries;
  }
  function resume(): Promise<void> {
    requested = true;
    if (!active) {
      const draining = drain();
      active = draining.then(() => undefined).finally(() => { active = undefined; });
      completion = draining.then(async summaries => { await Promise.all(summaries); });
      return completion;
    }
    return completion!;
  }
  return { resume, exclusive };
}

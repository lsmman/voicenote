import type { LocalStore } from '../store/types';
import type { TranscriberEngine, TranscriptionQueueEvents } from '../transcriber/types';
import { mergeSegments } from './mergeSegments';

export function createTranscriptionQueue(deps: {
  store: LocalStore; engine: TranscriberEngine; getModelId(): Promise<string>;
  now(): number; newId(): string; summarize(noteId: string): Promise<void>;
  events: TranscriptionQueueEvents;
}) {
  // Resets and inference share a lock: late inference cannot restore cleared segments.
  let tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  }

  async function drain() {
    const notes = (await deps.store.listNotes()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const initial of notes) {
      if (!['recording', 'transcribing', 'summarizing'].includes(initial.status)) continue;
      try {
        let chunks = (await deps.store.listChunks(initial.id)).sort((a, b) => a.seq - b.seq);
        deps.events.onProgress(initial.id, chunks.filter(chunk => chunk.transcribedAt !== null).length, chunks.length);
        while (chunks.some(chunk => chunk.transcribedAt === null)) {
          const note = await deps.store.getNote(initial.id);
          if (!note || !['recording', 'transcribing'].includes(note.status)) break;
          const modelId = note.modelName ?? await deps.getModelId();
          if (!await deps.engine.isModelReady(modelId)) break;
          await deps.engine.load(modelId);
          await deps.store.updateNote(note.id, { modelName: modelId });
          const index = chunks.findIndex(chunk => chunk.transcribedAt === null);
          const chunk = chunks[index];
          const existing = await deps.store.listSegments(note.id);
          const incoming = await deps.engine.transcribeChunk(chunk, {
            prevChunk: index > 0 ? chunks[index - 1] : undefined,
            prompt: existing[existing.length - 1]?.text.slice(-200), language: 'ko',
          });
          const merged = mergeSegments(existing, incoming, chunk.startMs, note.id, deps.newId);
          // Upsert only new segments: do not overwrite concurrent manual edits.
          await deps.store.putSegments(note.id, merged.slice(existing.length));
          await deps.store.updateChunk(note.id, chunk.seq, { transcribedAt: new Date(deps.now()).toISOString() });
          if (chunk.durationMs === 0) {
            const durationMs = Math.max(0, ...incoming.map(segment => segment.endMs));
            await deps.store.updateChunk(note.id, chunk.seq, { durationMs });
          }
          const current = await deps.store.getNote(note.id);
          if (current) await deps.store.updateNote(note.id, {
            durationMs: Math.max(current.durationMs, chunk.startMs + chunk.durationMs, merged[merged.length - 1]?.endMs ?? 0),
          });
          deps.events.onSegments(note.id, await deps.store.listSegments(note.id));
          chunks = (await deps.store.listChunks(note.id)).sort((a, b) => a.seq - b.seq);
          deps.events.onProgress(note.id, chunks.filter(chunk => chunk.transcribedAt !== null).length, chunks.length);
        }
        const note = await deps.store.getNote(initial.id);
        if (note && !chunks.some(chunk => chunk.transcribedAt === null)) {
          if (note.status === 'transcribing') {
            await deps.store.updateNote(note.id, { status: 'summarizing' });
            await deps.summarize(note.id);
          } else if (note.status === 'summarizing') await deps.summarize(note.id);
        }
      } catch (error) {
        deps.events.onError(initial.id, error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
  return { resume: () => exclusive(drain), exclusive };
}

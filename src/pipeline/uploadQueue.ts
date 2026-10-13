import type { LocalStore } from '../store/types';
import type { SyncService } from '../sync/types';

export function createUploadQueue(deps: {
  store: LocalStore; sync: SyncService; isOnline(): Promise<boolean>;
  isSignedIn(): Promise<boolean>; now(): number;
}) {
  let active: Promise<void> | undefined;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAt = 0;
  let delay = 2_000;

  function retry() {
    retryAt = deps.now() + delay;
    timer = setTimeout(() => {
      timer = undefined;
      retryAt = 0;
      void resume().catch(() => { /* Next foreground resume can retry store failures. */ });
    }, delay);
    delay = Math.min(delay * 2, 300_000);
  }

  async function drain() {
    do {
      requested = false;
      if (retryAt > deps.now()) return;
      if (timer) { clearTimeout(timer); timer = undefined; }
      const notes = (await deps.store.listNotes()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const note of notes) {
        const chunks = (await deps.store.listChunks(note.id)).sort((a, b) => a.seq - b.seq);
        for (const chunk of chunks) {
          if (chunk.remotePath !== null) continue;
          try {
            if (!await deps.isOnline() || !await deps.isSignedIn()) { retry(); return; }
            const remotePath = await deps.sync.uploadChunk(chunk);
            await deps.store.updateChunk(chunk.noteId, chunk.seq, {
              remotePath, uploadedAt: new Date(deps.now()).toISOString(),
            });
            delay = 2_000;
          } catch { retry(); return; }
        }
      }
    } while (requested);
  }

  function resume(): Promise<void> {
    requested = true;
    if (!active) active = drain().finally(() => { active = undefined; });
    return active;
  }
  return { resume };
}

/** Explicit opt-in cleanup; uploading never invokes this. Native deletion is injected. */
export function createCleanupLocal(store: LocalStore, deleteFile: (uri: string) => Promise<void>) {
  return async function cleanupLocal(noteId: string): Promise<void> {
    const note = await store.getNote(noteId);
    const chunks = await store.listChunks(noteId);
    if (note?.status !== 'done' || chunks.some(chunk => !chunk.remotePath || !chunk.uploadedAt)) return;
    for (const chunk of chunks) {
      if (!chunk.localPath) continue;
      if (store.deleteAudioBlob) await store.deleteAudioBlob(chunk.localPath);
      else await deleteFile(chunk.localPath);
      await store.updateChunk(noteId, chunk.seq, { localPath: null });
    }
  };
}

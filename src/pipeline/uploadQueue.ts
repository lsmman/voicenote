import type { LocalStore } from '../store/types';
import type { SyncService } from '../sync/types';
import { withTimeout } from './timeout';
import { resolveLocalPath } from '../recorder/paths';

function permanent(error: unknown): boolean {
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; message?: unknown; code?: unknown } | null;
  const status = Number(value?.status ?? value?.statusCode ?? value?.response?.status);
  const message = String(value?.message ?? error);
  return (status >= 400 && status < 500) ||
    /\b4\d\d\b|ENOENT|no such file|file.*(missing|not found|does not exist)|missing.*file|동기화가 설정되지 않았습니다|오디오 파일이 없습니다|저장된 오디오가 없습니다/i.test(message) || value?.code === 'ENOENT';
}

export function createUploadQueue(deps: {
  store: LocalStore; sync: SyncService; isOnline(): Promise<boolean>;
  isSignedIn(): Promise<boolean>; now(): number;
}) {
  let active: Promise<void> | undefined;
  let requested = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const skipped = new Set<string>();
  const retries = new Map<string, { at: number; delay: number }>();

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!retries.size) return;
    const at = Math.min(...[...retries.values()].map(retry => retry.at));
    timer = setTimeout(() => { timer = undefined; void resume().catch(() => undefined); }, Math.max(0, at - deps.now()));
  }
  function retry(key: string) {
    const delay = retries.get(key)?.delay ?? 2_000;
    retries.set(key, { at: deps.now() + delay, delay: Math.min(delay * 2, 300_000) });
  }
  async function drain() {
    do {
      requested = false;
      const notes = (await deps.store.listNotes()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      for (const note of notes) {
        for (const chunk of (await deps.store.listChunks(note.id)).sort((a, b) => a.seq - b.seq)) {
          const key = `${chunk.noteId}:${chunk.seq}`;
          if (chunk.remotePath !== null || skipped.has(key)) { retries.delete(key); continue; }
          if (!chunk.localPath) { skipped.add(key); retries.delete(key); continue; }
          if ((retries.get(key)?.at ?? 0) > deps.now()) continue;
          try {
            if (!await deps.isOnline() || !await deps.isSignedIn()) { retry(key); continue; }
            const remotePath = await withTimeout(deps.sync.uploadChunk(chunk), 120_000);
            await deps.store.updateChunk(chunk.noteId, chunk.seq, {
              remotePath, uploadedAt: new Date(deps.now()).toISOString(),
            });
            retries.delete(key);
          } catch (error) {
            if (permanent(error)) { skipped.add(key); retries.delete(key); }
            else retry(key);
          }
        }
      }
    } while (requested);
  }
  function resume(force: boolean | { force?: boolean } = false): Promise<void> {
    if (typeof force === 'boolean' ? force : force.force) retries.clear();
    requested = true;
    if (!active) active = drain().finally(() => { active = undefined; schedule(); });
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
      else await deleteFile(resolveLocalPath(chunk.localPath));
      await store.updateChunk(noteId, chunk.seq, { localPath: null });
    }
  };
}

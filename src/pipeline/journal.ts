import { withTimeout } from './timeout';

/** Retry persistence independently of recording lifecycle. flush never waits for backoff. */
export function createJournal(now: () => number, onSaved: (noteId: string) => Promise<void>) {
  const pending = new Set<{ noteId: string; atMs: number; operation(): Promise<void>; retryAt: number; delay: number }>();
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function drain() {
    for (const item of pending) {
      if (item.retryAt > now()) continue;
      try {
        await withTimeout(item.operation(), 120_000);
        pending.delete(item);
        await onSaved(item.noteId);
      } catch {
        item.retryAt = now() + item.delay;
        item.delay = Math.min(item.delay * 2, 300_000);
      }
    }
  }
  function flush(): Promise<void> {
    if (!active) active = drain().finally(() => {
      active = undefined;
      if (timer) clearTimeout(timer);
      if (pending.size) timer = setTimeout(() => { void flush(); }, Math.max(0, Math.min(...[...pending].map(p => p.retryAt)) - now()));
    });
    return active;
  }
  return {
    add(noteId: string, atMs: number, operation: () => Promise<void>) {
      pending.add({ noteId, atMs, operation, retryAt: 0, delay: 2_000 });
      void flush();
    },
    flush,
    pending: (noteId: string) => [...pending].filter(p => p.noteId === noteId),
  };
}

import type { Pipeline } from '../pipeline/types';

export const RECORDING_LOCK = 'voicenote-recording';
export function recordingLockHeld(snapshot: { held?: { name?: string }[] }): boolean {
  return snapshot.held?.some(lock => lock.name === RECORDING_LOCK) ?? false;
}
export function webLocks(web: boolean): LockManager | undefined {
  return web && typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : undefined;
}
export function alreadyActive(error: unknown): boolean {
  return error instanceof Error && /already active/i.test(error.message);
}

// Shared by mounted record screens. The lock belongs to the session, not its route.
let sessionStart: Promise<string> | null = null;
export function startOrAttachRecording(pipeline: Pipeline, locks?: LockManager): Promise<string> {
  if (sessionStart) return sessionStart;
  let resolveStart!: (id: string) => void;
  let rejectStart!: (error: unknown) => void;
  const result = new Promise<string>((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  sessionStart = result;
  const run = async () => {
    let lastId: string | null = null;
    let seenLive = false;
    let starting = true;
    let finish!: () => void;
    let attach!: (id: string) => void;
    const ended = new Promise<void>(resolve => { finish = resolve; });
    const attached = new Promise<string>(resolve => { attach = resolve; });
    const unsubscribe = pipeline.subscribe(state => {
      lastId = state?.noteId ?? null;
      if (state) { seenLive = true; attach(state.noteId); }
      else if (seenLive && !starting) finish();
    });
    try {
      let id: string | null = lastId;
      if (!id) {
        try { id = await pipeline.startRecording(); }
        catch (error) {
          if (!alreadyActive(error)) throw error;
          // A concurrent start may not have emitted its first live state yet.
          id = lastId ?? await attached;
        }
      }
      starting = false;
      resolveStart(id);
      if (seenLive && !lastId) finish();
      await ended;
    } finally { unsubscribe(); }
  };
  const work = locks
    ? locks.request(RECORDING_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('다른 탭에서 녹음 중이에요. 해당 탭으로 돌아가 주세요.');
      await run();
    })
    : run();
  void work.catch(rejectStart).finally(() => { if (sessionStart === result) sessionStart = null; });
  return result;
}

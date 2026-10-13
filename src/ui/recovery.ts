import type { Note } from '../core/types';
import type { Pipeline } from '../pipeline/types';
import type { LocalStore } from '../store/types';
import { RECORDING_LOCK, recordingLockHeld } from './recordingSession';
export type RecoveryChoice = 'recover' | 'discard' | 'later';
export async function recoverUnfinished({ pipeline, store, web, locks, seen, choose, onError }: {
  pipeline: Pick<Pipeline, 'findUnfinished' | 'recover'>;
  store: Pick<LocalStore, 'getNote' | 'deleteNote'>;
  web: boolean; locks?: LockManager; seen: Set<string>;
  choose: (note: Note) => Promise<RecoveryChoice>; onError: () => void;
}): Promise<void> {
  for (const note of await pipeline.findUnfinished()) {
    if (seen.has(note.id)) continue;
    try {
      // Unknown web lock state is not evidence of an abandoned recording.
      if (web && note.status === 'recording' && (!locks || recordingLockHeld(await locks.query()))) continue;
      const offer = async () => {
        // Another tab may have finalized/deleted it since findUnfinished.
        const current = await store.getNote(note.id);
        if (!current || current.status !== 'recording' || seen.has(note.id)) return;
        seen.add(note.id);
        const choice = await choose(current);
        if (choice === 'recover') await pipeline.recover(note.id);
        if (choice === 'discard') await store.deleteNote(note.id);
      };
      // Close the query/prompt race, holding the lock through recovery/discard.
      if (web && locks) await locks.request(RECORDING_LOCK, { mode: 'exclusive', ifAvailable: true }, async lock => { if (lock) await offer(); });
      else await offer();
    } catch { onError(); }
  }
}

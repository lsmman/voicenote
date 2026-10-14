import { store, sync } from '../services';
// Pull APIs return data; they do not persist it. Without revision/tombstone
// metadata we only fill missing records, never overwrite local edits.
export async function pullMissingNotes(): Promise<void> {
  const remote = await sync.pullNotes();
  for (const note of remote) {
    if (await store.getNote(note.id)) continue;
    // Chunks first: a note without its chunk rows would look like it still needs transcription.
    const chunks = await sync.pullChunks(note.id);
    await store.createNote(note);
    for (const chunk of chunks) await store.addChunk(chunk);
  }
}
export async function pullMissingDetail(noteId: string): Promise<void> {
  const remote = await sync.pullNoteDetail(noteId);
  const [segments, memos, summary] = await Promise.all([store.listSegments(noteId), store.listMemos(noteId), store.getSummary(noteId)]);
  const segmentIds = new Set(segments.map(item => item.id));
  const missing = remote.segments.filter(item => !segmentIds.has(item.id));
  if (missing.length) await store.putSegments(noteId, missing);
  const memoIds = new Set(memos.map(item => item.id));
  for (const memo of remote.memos) if (!memoIds.has(memo.id)) await store.addMemo(memo);
  if (!summary && remote.summary) await store.putSummary(remote.summary);
}

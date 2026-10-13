import type { AudioChunk, Memo, Note, Segment, Summary, SummaryItem } from '../core/types';

export const noteToRow = (n: Note, userId: string) => ({
  id: n.id, user_id: userId, title: n.title, created_at: n.createdAt,
  duration_ms: n.durationMs, status: n.status, model_name: n.modelName,
  gaps: n.gaps.map(g => ({ at_ms: g.atMs, reason: g.reason })),
});
export const noteFromRow = (r: ReturnType<typeof noteToRow>): Note => ({
  id: r.id, userId: r.user_id, title: r.title, createdAt: r.created_at,
  durationMs: r.duration_ms, status: r.status, modelName: r.model_name,
  gaps: r.gaps.map(g => ({ atMs: g.at_ms, reason: g.reason })),
});
export const segmentToRow = (s: Segment) => ({
  id: s.id, note_id: s.noteId, start_ms: s.startMs, end_ms: s.endMs,
  text: s.text, speaker_label: s.speakerLabel, edited: s.edited,
});
export const segmentFromRow = (r: ReturnType<typeof segmentToRow>): Segment => ({
  id: r.id, noteId: r.note_id, startMs: r.start_ms, endMs: r.end_ms,
  text: r.text, speakerLabel: r.speaker_label, edited: r.edited,
});
export const memoToRow = (m: Memo) => ({
  id: m.id, note_id: m.noteId, at_ms: m.atMs, text: m.text, kind: m.kind,
});
export const memoFromRow = (r: ReturnType<typeof memoToRow>): Memo => ({
  id: r.id, noteId: r.note_id, atMs: r.at_ms, text: r.text, kind: r.kind,
});
const itemToRow = (i: SummaryItem) => ({ text: i.text, at_ms: i.atMs });
const itemFromRow = (r: ReturnType<typeof itemToRow>): SummaryItem => ({ text: r.text, atMs: r.at_ms });
export const summaryToRow = (s: Summary) => ({
  note_id: s.noteId, summary: s.summary.map(itemToRow), keywords: s.keywords,
  todos: s.todos.map(itemToRow), created_at: s.createdAt,
});
export const summaryFromRow = (r: ReturnType<typeof summaryToRow>): Summary => ({
  noteId: r.note_id, summary: r.summary.map(itemFromRow), keywords: r.keywords,
  todos: r.todos.map(itemFromRow), createdAt: r.created_at,
});
export const chunkToRow = (c: AudioChunk) => ({
  note_id: c.noteId, seq: c.seq, start_ms: c.startMs, duration_ms: c.durationMs,
  local_path: c.localPath, mime_type: c.mimeType, remote_path: c.remotePath,
  uploaded_at: c.uploadedAt, transcribed_at: c.transcribedAt,
});
export const chunkFromRow = (r: ReturnType<typeof chunkToRow>): AudioChunk => ({
  noteId: r.note_id, seq: r.seq, startMs: r.start_ms, durationMs: r.duration_ms,
  localPath: r.local_path, mimeType: r.mime_type, remotePath: r.remote_path,
  uploadedAt: r.uploaded_at, transcribedAt: r.transcribed_at,
});

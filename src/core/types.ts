// Shared domain types. All times are milliseconds from recording start,
// with paused spans removed from the timeline.

export type NoteStatus =
  | 'recording'
  | 'transcribing'
  | 'summarizing'
  | 'done'
  | 'error';

export interface Note {
  id: string;
  userId: string | null; // null until signed in / synced
  title: string;
  createdAt: string; // ISO
  durationMs: number;
  status: NoteStatus;
  modelName: string | null;
  // Spans where recording was interrupted (phone call, mic loss).
  gaps: { atMs: number; reason: string }[];
}

export interface AudioChunk {
  noteId: string;
  seq: number; // 0-based, contiguous
  startMs: number;
  durationMs: number;
  localPath: string | null; // native file uri or web IndexedDB key
  mimeType: string;
  remotePath: string | null; // set only after upload is confirmed
  uploadedAt: string | null;
  transcribedAt: string | null;
}

export interface Segment {
  id: string;
  noteId: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerLabel: string | null; // manual in phase 1
  edited: boolean;
}

export type MemoKind = 'memo' | 'bookmark';

export interface Memo {
  id: string;
  noteId: string;
  atMs: number;
  text: string;
  kind: MemoKind;
}

export interface SummaryItem {
  text: string;
  atMs: number | null; // evidence segment time, for seek
}

export interface Summary {
  noteId: string;
  summary: SummaryItem[];
  keywords: string[];
  todos: SummaryItem[];
  createdAt: string;
}

export const CHUNK_MS = 30_000;
export const OVERLAP_MS = 1_000;

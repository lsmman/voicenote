import type { AudioChunk, Memo, Note, Segment, Summary } from '../core/types';

// Local persistence. Native: expo-sqlite. Web: IndexedDB (idb).
// Source of truth on the device; sync mirrors it to Supabase.
export interface LocalStore {
  init(): Promise<void>;

  createNote(note: Note): Promise<void>;
  updateNote(id: string, patch: Partial<Note>): Promise<void>;
  getNote(id: string): Promise<Note | null>;
  listNotes(query?: string): Promise<Note[]>; // newest first; query matches title + segment text
  deleteNote(id: string): Promise<void>;

  addChunk(chunk: AudioChunk): Promise<void>;
  updateChunk(noteId: string, seq: number, patch: Partial<AudioChunk>): Promise<void>;
  listChunks(noteId: string): Promise<AudioChunk[]>; // ordered by seq

  putSegments(noteId: string, segments: Segment[]): Promise<void>; // upsert by id
  replaceSegments(noteId: string, segments: Segment[]): Promise<void>;
  updateSegment(id: string, patch: Partial<Segment>): Promise<void>;
  listSegments(noteId: string): Promise<Segment[]>; // ordered by startMs

  addMemo(memo: Memo): Promise<void>;
  deleteMemo(id: string): Promise<void>;
  listMemos(noteId: string): Promise<Memo[]>;

  putSummary(summary: Summary): Promise<void>;
  getSummary(noteId: string): Promise<Summary | null>;

  // Raw audio bytes for web chunks (native uses files on disk).
  putAudioBlob?(key: string, blob: Blob): Promise<void>;
  getAudioBlob?(key: string): Promise<Blob | null>;
  deleteAudioBlob?(key: string): Promise<void>;
}

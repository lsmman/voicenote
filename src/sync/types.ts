import type { AudioChunk, Memo, Note, Segment, Summary } from '../core/types';

export interface SummarizeRequest {
  noteId: string;
  title: string;
  segments: Pick<Segment, 'startMs' | 'endMs' | 'text' | 'speakerLabel'>[];
  memos: Pick<Memo, 'atMs' | 'text' | 'kind'>[];
}

export type SummarizeResponse = Omit<Summary, 'noteId' | 'createdAt'> & { title: string };

export interface SyncService {
  // Upload one chunk's audio to Supabase Storage; resolves with remote path
  // only after the server confirms. Path: `${userId}/${noteId}/${seq}.${ext}`
  uploadChunk(chunk: AudioChunk): Promise<string>;
  pushNote(note: Note, segments: Segment[], memos: Memo[], summary: Summary | null): Promise<void>;
  // Upsert uploaded chunks' metadata rows so other devices can play them. Requires the note row.
  pushChunks(chunks: AudioChunk[]): Promise<void>;
  pullNotes(): Promise<Note[]>;
  pullChunks(noteId: string): Promise<AudioChunk[]>;
  pullNoteDetail(noteId: string): Promise<{ segments: Segment[]; memos: Memo[]; summary: Summary | null }>;
  chunkUrl(remotePath: string): Promise<string>; // signed URL for playback
  summarize(req: SummarizeRequest): Promise<SummarizeResponse>; // POST /api/summarize with Supabase JWT
}

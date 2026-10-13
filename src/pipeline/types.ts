import type { Memo, MemoKind, Note, Segment } from '../core/types';
import type { RecorderState, RecorderWarning } from '../recorder/types';

export type ModelState =
  | { kind: 'ready'; modelId: string }
  | { kind: 'downloading'; modelId: string; progress: number } // 0..1
  | { kind: 'waiting-wifi'; modelId: string; sizeBytes: number }
  | { kind: 'error'; modelId: string; message: string };

export interface LiveSessionState {
  noteId: string;
  state: RecorderState;
  elapsedMs: number;
  level: number;
  warnings: RecorderWarning[];
  liveSegments: Segment[]; // transcribed so far
  memos: Memo[];
  pendingChunks: number; // recorded but not yet transcribed
}

// App-facing orchestration. UI talks only to this (plus LocalStore reads).
export interface Pipeline {
  // Recording session
  startRecording(title?: string): Promise<string>; // returns noteId
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  stopRecording(): Promise<void>; // note -> 'transcribing' until queue drains, then summarize
  addMemo(text: string, kind: MemoKind): Promise<Memo>; // atMs = current elapsed
  subscribe(listener: (s: LiveSessionState | null) => void): () => void;

  // Import an existing audio file (split into CHUNK_MS chunks, same path as recording)
  importFile(uri: string, name: string, mimeType: string): Promise<string>;

  // Recovery: notes left in 'recording' by a crash
  findUnfinished(): Promise<Note[]>;
  recover(noteId: string): Promise<void>; // finalize with saved chunks, resume queues

  // Background work (call on app start / foreground)
  resumeQueues(): Promise<void>;
  onNoteProgress(listener: (noteId: string, done: number, total: number) => void): () => void;

  // Model auto-download: started automatically when transcription is needed
  // and the selected model is missing (native: Wi-Fi only; web: always).
  onModelState(listener: (s: ModelState) => void): () => void;
  downloadModelNow(): Promise<void>; // user-confirmed download (e.g. on cellular)

  retranscribe(noteId: string, modelId: string): Promise<void>;
  resummarize(noteId: string): Promise<void>;
}

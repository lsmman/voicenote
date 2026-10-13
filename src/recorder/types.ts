import type { AudioChunk } from '../core/types';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopping';

export type RecorderWarning =
  | { kind: 'mic-ended' }
  | { kind: 'silence'; forMs: number }
  | { kind: 'low-storage'; freeBytes: number }
  | { kind: 'interrupted'; reason: string };

export interface RecorderEvents {
  // Fired after a chunk is durably written to disk/IndexedDB and journaled.
  onChunk(chunk: AudioChunk): void;
  onLevel(level: number): void; // 0..1, ~10Hz
  onElapsed(ms: number): void; // timeline ms (pauses excluded)
  onWarning(w: RecorderWarning): void;
  onStateChange(s: RecorderState): void;
}

// Platform recorder: src/recorder/native.ts and src/recorder/web.ts
// both implement this. Resolved via src/recorder/index.ts (.native/.web).
export interface Recorder {
  start(noteId: string, events: Partial<RecorderEvents>): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>; // flushes the last partial chunk
  getState(): RecorderState;
}

import type { AudioChunk, Segment } from '../core/types';

export interface ModelInfo {
  id: string; // e.g. 'large-v3-turbo-q5_0', 'small-q5_1'
  label: string;
  sizeBytes: number;
  recommended: boolean;
}

export interface ModelDownloadProgress {
  modelId: string;
  receivedBytes: number;
  totalBytes: number;
}

// Platform engine: whisper.rn on native, transformers.js (WebGPU, Web Worker) on web.
export interface TranscriberEngine {
  listModels(): ModelInfo[];
  isModelReady(modelId: string): Promise<boolean>;
  downloadModel(modelId: string, onProgress?: (p: ModelDownloadProgress) => void): Promise<void>;
  deleteModel(modelId: string): Promise<void>;
  load(modelId: string): Promise<void>;
  // Transcribe one chunk. When `prevChunk` is given, the engine prepends its
  // last OVERLAP_MS of audio so words cut at the boundary are recovered;
  // returned times are relative to `chunk` start (may be negative inside the
  // overlap). Duplicates are removed later by mergeSegments().
  transcribeChunk(
    chunk: AudioChunk,
    opts: { prevChunk?: AudioChunk; prompt?: string; language: 'ko' | 'en' | 'zh' },
  ): Promise<{ startMs: number; endMs: number; text: string }[]>; // times relative to chunk start
}

export interface TranscriptionQueueEvents {
  onSegments(noteId: string, segments: Segment[]): void;
  onProgress(noteId: string, done: number, total: number): void;
  onError(noteId: string, error: Error): void;
}

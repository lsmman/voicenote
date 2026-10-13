import type { ModelDownloadProgress } from '../types';

export type SegmentResult = { text: string; startMs: number; endMs: number };
export type WorkerCommand =
  | { kind: 'load'; modelId: string }
  | { kind: 'delete'; modelId: string }
  | { kind: 'transcribe'; audio: Float32Array; overlapMs: number };
export type WorkerRequest = WorkerCommand & { id: number };
export type WorkerResponse =
  | { id: number; kind: 'progress'; progress: ModelDownloadProgress }
  | { id: number; kind: 'result'; segments?: SegmentResult[] }
  | { id: number; kind: 'error'; message: string };

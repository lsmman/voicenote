import type { TranscriptionModel } from '../models';
import type { ModelDownloadProgress } from '../types';

export type SegmentResult = { text: string; startMs: number; endMs: number };
export type WorkerCommand =
  | { kind: 'load'; modelId: string; model: TranscriptionModel['web'] }
  | { kind: 'delete'; modelId: string; repo: string }
  | { kind: 'transcribe'; audio: Float32Array; overlapMs: number; language: 'ko' | 'en' | 'zh' };
export type WorkerRequest = WorkerCommand & { id: number };
export type WorkerResponse =
  | { id: number; kind: 'progress'; progress: ModelDownloadProgress }
  | { id: number; kind: 'result'; segments?: SegmentResult[] }
  | { id: number; kind: 'error'; message: string };

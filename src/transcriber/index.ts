import { store } from '../store';
import type { AudioChunk } from '../core/types';
import { downmix, resample, webAudioWindows, SAMPLE_RATE } from './audio';
import { getModel, listModels } from './models';
import { createSerialQueue } from './serial';
import type { ModelDownloadProgress, TranscriberEngine } from './types';
import type { SegmentResult, WorkerCommand, WorkerResponse } from './web/protocol';

const serial = createSerialQueue();
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, {
  resolve: (segments: SegmentResult[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  progress?: (progress: ModelDownloadProgress) => void;
}>();
const readyKey = (id: string) => `voicenote.transcriber.ready.v1.${id}`;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker('/transcribe-worker.js', { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const task = pending.get(data.id);
    if (!task) return;
    if (data.kind === 'progress') { task.progress?.(data.progress); return; }
    clearTimeout(task.timer);
    pending.delete(data.id);
    if (data.kind === 'error') task.reject(new Error(data.message));
    else task.resolve(data.segments ?? []);
  };
  const fail = () => resetWorker(new Error('Transcription worker failed; load the model again'));
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return worker;
}

function resetWorker(error: Error) {
  worker?.terminate();
  worker = undefined;
  for (const task of pending.values()) {
    clearTimeout(task.timer);
    task.reject(error);
  }
  pending.clear();
}

function request(command: WorkerCommand, progress?: (p: ModelDownloadProgress) => void): Promise<SegmentResult[]> {
  const target = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeoutMs = command.kind === 'transcribe' ? 10 * 60_000 : 30 * 60_000;
    const timer = setTimeout(() => resetWorker(new Error(`Transcription ${command.kind} timed out; load the model again`)), timeoutMs);
    pending.set(id, { resolve, reject, progress, timer });
    try {
      target.postMessage({ ...command, id }, command.kind === 'transcribe' ? [command.audio.buffer] : []);
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}

async function decode(chunk: AudioChunk, context: AudioContext): Promise<Float32Array> {
  if (!chunk.localPath) throw new Error('Audio chunk has no local path');
  if (!store.getAudioBlob) throw new Error('Audio blob storage is unavailable');
  const blob = await store.getAudioBlob(chunk.localPath);
  if (!blob) throw new Error(`Audio blob is missing: ${chunk.localPath}`);
  const decoded = await context.decodeAudioData(await blob.arrayBuffer());
  // This function's AudioBuffer/channel references die before any inference starts.
  return resample(downmix(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i))), decoded.sampleRate);
}

async function load(id: string, progress?: (p: ModelDownloadProgress) => void) {
  getModel(id);
  try {
    await request({ kind: 'load', modelId: id, model: getModel(id).web }, progress);
  } catch (error) {
    try { localStorage.removeItem(readyKey(id)); } catch { /* Storage may be disabled. */ }
    throw error;
  }
  // isModelReady also checks the browser cache for eviction.
  try { localStorage.setItem(readyKey(id), '1'); } catch { /* Inference still works without storage. */ }
}

export const engine: TranscriberEngine = {
  listModels,
  async isModelReady(id) {
    const model = getModel(id);
    try {
      if (localStorage.getItem(readyKey(id)) !== '1') return false;
      // Verified in installed 4.3.1 src/env.js (env.cacheKey).
      const cache = await caches.open('transformers-cache');
      const present = (await cache.keys()).some((entry) => {
        const url = new URL(entry.url);
        return url.hostname === 'huggingface.co' && url.pathname.startsWith(`/${model.web.repo}/`);
      });
      if (present) return true;
    } catch { /* Storage/cache may be unavailable. */ }
    try { localStorage.removeItem(readyKey(id)); } catch { /* Storage may be disabled. */ }
    return false;
  },
  downloadModel: (id, progress) => serial(() => load(id, progress)),
  load: (id) => serial(() => load(id)),
  deleteModel: (id) => serial(async () => {
    getModel(id);
    try { localStorage.removeItem(readyKey(id)); } catch { /* Storage may be disabled. */ }
    await request({ kind: 'delete', modelId: id, repo: getModel(id).web.repo });
  }),
  transcribeChunk: (chunk, { prevChunk, language }) => serial(async () => {
    const context = new AudioContext();
    try {
      // Retain only the previous second before decoding a potentially hours-long import.
      const previousTail = async () => prevChunk
        ? (await decode(prevChunk, context)).slice(-SAMPLE_RATE) : undefined;
      const previous = await previousTail();
      const current = await decode(chunk, context);
      const segments: SegmentResult[] = [];
      for (const { audio, startMs } of webAudioWindows(current, previous)) {
        const result = await request({ kind: 'transcribe', audio, overlapMs: 0, language });
        segments.push(...result.map((segment) => ({
          ...segment, startMs: segment.startMs + startMs, endMs: segment.endMs + startMs,
        })));
      }
      return segments;
    } finally {
      await context.close();
    }
  }),
};

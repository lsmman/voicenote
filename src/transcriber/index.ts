import { store } from '../store';
import type { AudioChunk } from '../core/types';
import { downmix, prependOverlap, SAMPLE_RATE } from './audio';
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
  progress?: (progress: ModelDownloadProgress) => void;
}>();
const readyKey = (id: string) => `voicenote.transcriber.ready.v1.${id}`;

function getWorker(): Worker {
  if (worker) return worker;
  // SDK 57 Metro's collect-dependencies explicitly transforms this syntax.
  worker = new Worker(new URL('./web/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const task = pending.get(data.id);
    if (!task) return;
    if (data.kind === 'progress') { task.progress?.(data.progress); return; }
    pending.delete(data.id);
    if (data.kind === 'error') task.reject(new Error(data.message));
    else task.resolve(data.segments ?? []);
  };
  const fail = () => {
    for (const task of pending.values()) task.reject(new Error('Transcription worker failed; load the model again'));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  worker.onerror = fail;
  worker.onmessageerror = fail;
  return worker;
}

function request(command: WorkerCommand, progress?: (p: ModelDownloadProgress) => void): Promise<SegmentResult[]> {
  const target = getWorker();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, progress });
    try {
      target.postMessage({ ...command, id }, command.kind === 'transcribe' ? [command.audio.buffer] : []);
    } catch (error) {
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
  if (decoded.sampleRate !== SAMPLE_RATE) throw new Error('Audio decoder did not resample to 16 kHz');
  return downmix(Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i)));
}

async function load(id: string, progress?: (p: ModelDownloadProgress) => void) {
  getModel(id);
  try {
    await request({ kind: 'load', modelId: id }, progress);
  } catch (error) {
    try { localStorage.removeItem(readyKey(id)); } catch { /* Storage may be disabled. */ }
    throw error;
  }
  // This is a successful-load marker, not proof against subsequent cache eviction.
  try { localStorage.setItem(readyKey(id), '1'); } catch { /* Inference still works without storage. */ }
}

export const engine: TranscriberEngine = {
  listModels,
  async isModelReady(id) {
    getModel(id);
    try { return localStorage.getItem(readyKey(id)) === '1'; } catch { return false; }
  },
  downloadModel: (id, progress) => serial(() => load(id, progress)),
  load: (id) => serial(() => load(id)),
  deleteModel: (id) => serial(async () => {
    getModel(id);
    try { localStorage.removeItem(readyKey(id)); } catch { /* Storage may be disabled. */ }
    await request({ kind: 'delete', modelId: id });
  }),
  transcribeChunk: (chunk, { prevChunk }) => serial(async () => {
    const context = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      const current = await decode(chunk, context);
      const previous = prevChunk ? await decode(prevChunk, context) : undefined;
      const { audio, overlapMs } = prependOverlap(current, previous);
      if (!audio.length) return [];
      return await request({ kind: 'transcribe', audio, overlapMs });
    } finally {
      await context.close();
    }
  }),
};

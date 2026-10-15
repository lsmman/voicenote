import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';

// Static module: deliberately outside Metro's dependency graph.
const SAMPLE_RATE = 16000;
let recognizer;
let loadedId;
let chosenDevice;
let gpuFailed = false;
let tail = Promise.resolve();
env.useBrowserCache = true;

async function dispose() {
  const old = recognizer;
  recognizer = undefined;
  loadedId = undefined;
  chosenDevice = undefined;
  if (old) await old.dispose();
}

function progressReporter(id, modelId) {
  const files = new Map();
  return (event) => {
    if (typeof event.loaded !== 'number' || typeof event.total !== 'number') return;
    let receivedBytes = event.loaded;
    let totalBytes = event.total;
    if (event.status === 'progress') {
      files.set(`${event.name}/${event.file}`, { loaded: event.loaded, total: event.total });
      receivedBytes = totalBytes = 0;
      for (const file of files.values()) {
        receivedBytes += file.loaded;
        totalBytes += file.total;
      }
    } else if (event.status !== 'progress_total') return;
    self.postMessage({ id, kind: 'progress', progress: { modelId, receivedBytes, totalBytes } });
  };
}

async function load(request) {
  if (recognizer && loadedId === request.modelId) return;
  await dispose();
  const { model } = request;
  const options = { progress_callback: progressReporter(request.id, request.modelId) };
  if (!gpuFailed) {
    try {
      const adapter = await navigator.gpu?.requestAdapter();
      // Large turbo's fp32 encoder is too costly; lack of f16 takes the q8 WASM path.
      if (adapter?.features.has('shader-f16')) {
        recognizer = await pipeline('automatic-speech-recognition', model.repo, {
          ...options, device: 'webgpu', dtype: model.gpuDtype,
        });
        chosenDevice = 'webgpu';
        const current = recognizer;
        // ORT exposes the actual inference device as a Promise, not the probe adapter.
        const device = await env.backends.onnx.webgpu.device;
        device.lost.then(() => {
          if (recognizer !== current) return;
          gpuFailed = true;
          // Clear immediately; cleanup is serialized before the next request.
          recognizer = undefined;
          loadedId = undefined;
          chosenDevice = undefined;
          tail = tail.then(() => current.dispose()).catch(() => undefined);
        });
      }
    } catch {
      gpuFailed = true;
      await dispose().catch(() => undefined);
    }
  }
  if (!recognizer) {
    recognizer = await pipeline('automatic-speech-recognition', model.repo, {
      ...options, device: 'wasm', dtype: model.wasmDtype,
    });
    chosenDevice = 'wasm';
  }
  loadedId = request.modelId;
}

async function execute(request) {
  if (request.kind === 'load') return load(request);
  if (request.kind === 'delete') {
    if (loadedId === request.modelId) await dispose();
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(env.cacheKey);
      for (const entry of await cache.keys()) {
        const url = new URL(entry.url);
        if (url.hostname === 'huggingface.co' && url.pathname.startsWith(`/${request.repo}/`)) {
          await cache.delete(entry);
        }
      }
    }
    return;
  }
  if (!recognizer) throw new Error('Load a transcription model first');
  const current = recognizer;
  try {
    const duration = request.audio.length / SAMPLE_RATE;
    const result = await current(request.audio, {
      language: { ko: 'korean', en: 'english', zh: 'chinese' }[request.language], task: 'transcribe', return_timestamps: true,
      ...(duration > 30.5 ? { chunk_length_s: 30, stride_length_s: 5 } : {}),
    });
    if (recognizer !== current) throw new Error('Transcription GPU device lost; load the model again');
    if (!result.chunks && result.text.trim()) throw new Error('Transcription returned no timestamps');
    // 4.3.1 WhisperTokenizer._decode_asr applies time_offset from each stride:
    // these timestamps are absolute within this request, including beyond 30s.
    return (result.chunks ?? []).map(({ text, timestamp: [start, end] }) => ({
      text,
      startMs: Math.round((start ?? 0) * 1000) - request.overlapMs,
      endMs: Math.round((end ?? duration) * 1000) - request.overlapMs,
    }));
  } catch (error) {
    if (chosenDevice === 'webgpu') gpuFailed = true;
    await dispose().catch(() => undefined);
    throw error;
  }
}

self.onmessage = ({ data }) => {
  tail = tail.then(async () => {
    try {
      const segments = await execute(data);
      self.postMessage({ id: data.id, kind: 'result', segments });
    } catch (error) {
      self.postMessage({ id: data.id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });
};

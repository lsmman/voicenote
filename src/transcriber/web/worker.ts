import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { mapWebSegments, SAMPLE_RATE } from '../audio';
import { getModel } from '../models';
import { createSerialQueue } from '../serial';
import { createProgressReporter } from './progress';
import type { WorkerRequest, WorkerResponse } from './protocol';

// Local structural type avoids adding lib.webworker to the app's DOM globals.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
let recognizer: AutomaticSpeechRecognitionPipeline | undefined;
let loadedId: string | undefined;
const serial = createSerialQueue();

async function dispose() {
  if (recognizer) await recognizer.dispose();
  recognizer = undefined;
  loadedId = undefined;
}

async function execute(request: WorkerRequest) {
  if (request.kind === 'load') {
    const model = getModel(request.modelId);
    if (loadedId !== model.id || !recognizer) {
      await dispose();
      const gpu = (navigator as Navigator & {
        gpu?: { requestAdapter(): Promise<{ features: { has(name: string): boolean } } | null> };
      }).gpu;
      const adapter = await gpu?.requestAdapter().catch(() => null);
      const device = adapter ? 'webgpu' : 'wasm';
      const dtype = adapter
        ? adapter.features.has('shader-f16') ? model.web.gpuDtype
          : { encoder_model: 'fp32' as const, decoder_model_merged: 'q4' as const }
        : model.web.wasmDtype;
      env.useBrowserCache = true;
      recognizer = await pipeline('automatic-speech-recognition', model.web.repo, {
        device, dtype,
        progress_callback: createProgressReporter(model.id, (progress) => {
          scope.postMessage({ id: request.id, kind: 'progress', progress });
        }),
      });
      loadedId = model.id;
    }
    return;
  }
  if (request.kind === 'delete') {
    const model = getModel(request.modelId);
    if (loadedId === model.id) await dispose();
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(env.cacheKey);
      for (const entry of await cache.keys()) {
        const url = new URL(entry.url);
        if (url.hostname === 'huggingface.co' && url.pathname.startsWith(`/${model.web.repo}/`)) {
          await cache.delete(entry);
        }
      }
    }
    return;
  }
  if (!recognizer) throw new Error('Load a transcription model first');
  // The installed tokenizer exposes no get_prompt_ids API; use acoustic overlap.
  const result = await recognizer(request.audio, {
    language: 'korean', task: 'transcribe', return_timestamps: true, chunk_length_s: 30,
  });
  if (!result.chunks && result.text.trim()) throw new Error('Transcription returned no timestamps');
  return mapWebSegments(result.chunks ?? [], request.audio.length * 1000 / SAMPLE_RATE, request.overlapMs);
}

scope.onmessage = ({ data }) => {
  void serial(async () => {
    try {
      const segments = await execute(data);
      scope.postMessage({ id: data.id, kind: 'result', segments });
    } catch (error) {
      scope.postMessage({ id: data.id, kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  });
};

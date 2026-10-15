import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { getModel } from '../models';
import type { WorkerCommand, WorkerResponse } from '../web/protocol';

const mockDispose = jest.fn(async () => undefined);
const mockRecognize = Object.assign(jest.fn(async () => ({
  text: '안녕하세요', chunks: [{ text: '안녕하세요', timestamp: [0.5, 2] }],
})), { dispose: mockDispose });
const mockPipeline = jest.fn(async (..._args: unknown[]) => mockRecognize);
const mockCacheDelete = jest.fn(async () => true);
const mockCacheKeys = jest.fn(async () => [
  { url: 'https://huggingface.co/onnx-community/whisper-base/resolve/main/onnx/encoder_model.onnx' },
  { url: 'https://huggingface.co/onnx-community/whisper-small/resolve/main/config.json' },
]);

let loseDevice: () => void;
const scope = {
  onmessage: (_event: { data: unknown }) => {},
  postMessage: (_response: WorkerResponse) => {},
  navigator: { gpu: undefined as undefined | { requestAdapter: () => Promise<{ features: Set<string> } | null> } },
  caches: { open: async () => ({ keys: mockCacheKeys, delete: mockCacheDelete }) },
};
let id = 0;
type TestCommand = Exclude<WorkerCommand, { kind: 'load' | 'delete' }> | { kind: 'load' | 'delete'; modelId: string };
function send(command: TestCommand): Promise<WorkerResponse> {
  const requestId = id++;
  return new Promise((resolve) => {
    scope.postMessage = (response) => {
      if (response.id === requestId && response.kind !== 'progress') resolve(response);
    };
    scope.onmessage({ data: { ...command, id: requestId,
      ...(command.kind === 'load' ? { model: getModel(command.modelId).web } : {}),
      ...(command.kind === 'delete' ? { repo: getModel(command.modelId).web.repo } : {}),
    } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  scope.navigator.gpu = undefined;
  const device = { lost: new Promise<void>((resolve) => { loseDevice = resolve; }) };
  const source = readFileSync(resolve(__dirname, '../../../public/transcribe-worker.js'), 'utf8');
  // Execute the shipped asset itself, replacing only its CDN import with test doubles.
  runInNewContext(source.replace(/^import .*;\n/, ''), {
    self: scope, navigator: scope.navigator, caches: scope.caches, URL, Error,
    pipeline: mockPipeline,
    env: { cacheKey: 'transformers-cache', backends: { onnx: { webgpu: { device: Promise.resolve(device) } } } },
  });
});

test('uses WASM without GPU, reuses loaded models and shifts timestamps', async () => {
  expect((await send({ kind: 'load', modelId: 'base-q5_1' })).kind).toBe('result');
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledTimes(1);
  expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'onnx-community/whisper-base', {
    device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, progress_callback: expect.any(Function),
  });
  const response = await send({ kind: 'transcribe', language: 'ko', audio: new Float32Array(48_000), overlapMs: 1000 });
  expect(response).toMatchObject({ kind: 'result', segments: [{ text: '안녕하세요', startMs: -500, endMs: 1000 }] });
  expect(mockRecognize).toHaveBeenCalledWith(expect.any(Float32Array), {
    language: 'korean', task: 'transcribe', return_timestamps: true,
  });
});

test.each([true, false])('selects WebGPU precision for shader-f16 support=%s', async (fp16) => {
  scope.navigator.gpu = { requestAdapter: async () => ({ features: new Set(fp16 ? ['shader-f16'] : []) }) };
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    device: fp16 ? 'webgpu' : 'wasm',
    dtype: fp16 ? { encoder_model: 'fp16', decoder_model_merged: 'q4' } : { encoder_model: 'q8', decoder_model_merged: 'q8' },
  }));
});

test('switching releases the old model; deletion removes only the requested repo', async () => {
  await send({ kind: 'load', modelId: 'small-q5_1' });
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockDispose).toHaveBeenCalledTimes(1);
  await send({ kind: 'delete', modelId: 'base-q5_1' });
  expect(mockDispose).toHaveBeenCalledTimes(2);
  expect(mockCacheDelete).toHaveBeenCalledTimes(1);
  expect(mockCacheDelete).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/whisper-base/') }));
});

test('load failure is reported and the worker can retry', async () => {
  mockPipeline.mockRejectedValueOnce(new Error('Download unavailable'));
  expect(await send({ kind: 'load', modelId: 'base-q5_1' })).toMatchObject({ kind: 'error', message: 'Download unavailable' });
  expect(await send({ kind: 'transcribe', language: 'ko', audio: new Float32Array(1), overlapMs: 0 })).toMatchObject({
    kind: 'error', message: 'Load a transcription model first',
  });
  expect((await send({ kind: 'load', modelId: 'base-q5_1' })).kind).toBe('result');
});


test('GPU initialization failure retries q8 WASM and remembers the loaded fallback', async () => {
  scope.navigator.gpu = { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) };
  mockPipeline.mockRejectedValueOnce(new Error('GPU initialization failed'));
  await send({ kind: 'load', modelId: 'base-q5_1' });
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledTimes(2);
  expect(mockPipeline.mock.calls[1][2]).toMatchObject({ device: 'wasm', dtype: getModel('base-q5_1').web.wasmDtype });
});

test('inference error disposes the recognizer and next load rebuilds', async () => {
  await send({ kind: 'load', modelId: 'base-q5_1' });
  mockRecognize.mockRejectedValueOnce(new Error('Inference failed'));
  expect(await send({ kind: 'transcribe', language: 'ko', audio: new Float32Array(1), overlapMs: 0 })).toMatchObject({ kind: 'error' });
  expect(mockDispose).toHaveBeenCalledTimes(1);
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledTimes(2);
});

test('device loss disposes and rebuilds with WASM', async () => {
  scope.navigator.gpu = { requestAdapter: async () => ({ features: new Set(['shader-f16']) }) };
  await send({ kind: 'load', modelId: 'base-q5_1' });
  loseDevice();
  await Promise.resolve();
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockDispose).toHaveBeenCalledTimes(1);
  expect(mockPipeline.mock.calls[1][2]).toMatchObject({ device: 'wasm' });
});

test.each([30.5, 30.501, 70])('chunking threshold and absolute timestamps for %ss', async (seconds) => {
  await send({ kind: 'load', modelId: 'base-q5_1' });
  mockRecognize.mockResolvedValueOnce({ text: 'later', chunks: [{ text: 'later', timestamp: [42, 45] }] });
  const response = await send({ kind: 'transcribe', language: 'ko', audio: new Float32Array(Math.round(seconds * 16000)), overlapMs: 0 });
  const options = (mockRecognize.mock.calls.at(-1) as unknown as [unknown, Record<string, unknown>])[1];
  if (seconds > 30.5) expect(options).toMatchObject({ chunk_length_s: 30, stride_length_s: 5 });
  else expect(options).not.toHaveProperty('chunk_length_s');
  expect(response).toMatchObject({ segments: [{ startMs: 42000, endMs: 45000 }] });
});

test.each([['ko', 'korean'], ['en', 'english'], ['zh', 'chinese']] as const)('maps %s to Whisper language %s', async (language, name) => {
  await send({ kind: 'load', modelId: 'base-q5_1' });
  await send({ kind: 'transcribe', language, audio: new Float32Array(16000), overlapMs: 0 });
  expect(mockRecognize).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({ language: name }));
});

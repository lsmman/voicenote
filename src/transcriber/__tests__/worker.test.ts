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

jest.mock('@huggingface/transformers', () => ({
  pipeline: (...args: unknown[]) => mockPipeline(...args),
  env: { cacheKey: 'transformers-cache', useBrowserCache: true },
}));

const scope = globalThis as unknown as {
  onmessage: (event: { data: WorkerCommand & { id: number } }) => void;
  postMessage: (response: WorkerResponse) => void;
  navigator: { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } };
  caches: { open: () => Promise<unknown> };
};
let id = 0;
function send(command: WorkerCommand): Promise<WorkerResponse> {
  const requestId = id++;
  return new Promise((resolve) => {
    scope.postMessage = (response) => {
      if (response.id === requestId && response.kind !== 'progress') resolve(response);
    };
    scope.onmessage({ data: { ...command, id: requestId } });
  });
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'caches', { configurable: true, value: {
    open: async () => ({ keys: mockCacheKeys, delete: mockCacheDelete }),
  } });
  require('../web/worker');
});

beforeEach(async () => {
  await send({ kind: 'delete', modelId: 'base-q5_1' });
  await send({ kind: 'delete', modelId: 'small-q5_1' });
  scope.navigator.gpu = undefined;
  jest.clearAllMocks();
});

test('uses WASM without GPU, reuses loaded models and shifts timestamps', async () => {
  expect((await send({ kind: 'load', modelId: 'base-q5_1' })).kind).toBe('result');
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledTimes(1);
  expect(mockPipeline).toHaveBeenCalledWith('automatic-speech-recognition', 'onnx-community/whisper-base', {
    device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, progress_callback: expect.any(Function),
  });
  const response = await send({ kind: 'transcribe', audio: new Float32Array(48_000), overlapMs: 1000 });
  expect(response).toMatchObject({ kind: 'result', segments: [{ text: '안녕하세요', startMs: -500, endMs: 1000 }] });
  expect(mockRecognize).toHaveBeenCalledWith(expect.any(Float32Array), {
    language: 'korean', task: 'transcribe', return_timestamps: true, chunk_length_s: 30,
  });
});

test.each([true, false])('selects WebGPU precision for shader-f16 support=%s', async (fp16) => {
  scope.navigator.gpu = { requestAdapter: async () => ({ features: new Set(fp16 ? ['shader-f16'] : []) }) };
  await send({ kind: 'load', modelId: 'base-q5_1' });
  expect(mockPipeline).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
    device: 'webgpu', dtype: { encoder_model: fp16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' },
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
  expect(await send({ kind: 'transcribe', audio: new Float32Array(1), overlapMs: 0 })).toMatchObject({
    kind: 'error', message: 'Load a transcription model first',
  });
  expect((await send({ kind: 'load', modelId: 'base-q5_1' })).kind).toBe('result');
});

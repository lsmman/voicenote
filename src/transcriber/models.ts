import type { PretrainedModelOptions } from '@huggingface/transformers';
import type { ModelInfo } from './types';

export interface TranscriptionModel extends ModelInfo {
  native: { file: string; url: string };
  web: { repo: string; gpuDtype: PretrainedModelOptions['dtype']; wasmDtype: PretrainedModelOptions['dtype'] };
}

// Decimal bytes, approximate repository sizes, not checksums or ONNX sizes.
export const MODELS: readonly TranscriptionModel[] = [
  ['large-v3-turbo-q5_0', 'Whisper Large v3 Turbo', 574_000_000, 'large-v3-turbo'],
  ['small-q5_1', 'Whisper Small', 190_000_000, 'small'],
  ['base-q5_1', 'Whisper Base', 59_700_000, 'base'],
].map(([id, label, sizeBytes, webName], index) => ({
  id: String(id), label: String(label), sizeBytes: Number(sizeBytes), recommended: index === 0,
  native: {
    file: `ggml-${id}.bin`,
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`,
  },
  web: {
    repo: `onnx-community/whisper-${webName}`,
    gpuDtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' },
    wasmDtype: { encoder_model: 'q8', decoder_model_merged: 'q8' },
  },
}));

export function getModel(id: string): TranscriptionModel {
  const model = MODELS.find((item) => item.id === id);
  if (!model) throw new Error(`Unknown transcription model: ${id}`);
  return model;
}

export function listModels(): ModelInfo[] {
  return MODELS.map(({ id, label, sizeBytes, recommended }) => ({ id, label, sizeBytes, recommended }));
}

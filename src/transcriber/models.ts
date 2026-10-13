import { Platform } from 'react-native';
import type { ModelInfo } from './types';

export type ModelDtype = 'fp16' | 'q4' | 'q8';
export type ModelPrecision = ModelDtype | Record<string, ModelDtype>;

export interface TranscriptionModel extends ModelInfo {
  native: { file: string; url: string; sizeBytes: number };
  web: { repo: string; sizeBytes: number; gpuDtype: ModelPrecision; wasmDtype: ModelPrecision };
}

// Approximate decimal download bytes: GGML native vs ONNX web (larger of GPU/q8 paths).
// Actual downloads vary with device/dtype; progress reports measured bytes.
export const MODELS: readonly TranscriptionModel[] = [
  ['large-v3-turbo-q5_0', 'Whisper Large v3 Turbo', 574_000_000, 'large-v3-turbo', 1_400_000_000],
  ['small-q5_1', 'Whisper Small', 190_000_000, 'small', 300_000_000],
  ['base-q5_1', 'Whisper Base', 59_700_000, 'base', 100_000_000],
].map(([id, label, sizeBytes, webName, webSizeBytes], index) => ({
  id: String(id), label: String(label), sizeBytes: Number(Platform.OS === 'web' ? webSizeBytes : sizeBytes), recommended: index === 0,
  native: {
    sizeBytes: Number(sizeBytes),
    file: `ggml-${id}.bin`,
    url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`,
  },
  web: {
    sizeBytes: Number(webSizeBytes),
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

import * as FileSystem from 'expo-file-system/legacy';
// 0.7.4 exports only subpaths (no "." entry); /index resolves its installed types.
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { whisperTicksToMs } from './audio';
import { getModel, listModels } from './models';
import { createSerialQueue } from './serial';
import type { TranscriberEngine } from './types';

let context: WhisperContext | undefined;
let loadedId: string | undefined;
const serial = createSerialQueue();

function modelPath(id: string) {
  const model = getModel(id);
  if (!FileSystem.documentDirectory) throw new Error('Document directory is unavailable');
  return `${FileSystem.documentDirectory}models/${model.native.file}`;
}

async function ready(id: string): Promise<boolean> {
  const info = await FileSystem.getInfoAsync(modelPath(id));
  return info.exists && !info.isDirectory && info.size >= getModel(id).sizeBytes * 0.9;
}

async function release() {
  if (context) await context.release();
  context = undefined;
  loadedId = undefined;
}

export const engine: TranscriberEngine = {
  listModels,
  isModelReady: ready,
  downloadModel: (id, onProgress) => serial(async () => {
    const model = getModel(id);
    const path = modelPath(id);
    if (await ready(id)) {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) onProgress?.({ modelId: id, receivedBytes: info.size, totalBytes: info.size });
      return;
    }
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}models`, { intermediates: true });
    const part = `${path}.part`;
    // Resumable API; this contract has no pause operation, so failed attempts restart.
    const download = FileSystem.createDownloadResumable(model.native.url, part, {}, (progress) => {
      onProgress?.({ modelId: id, receivedBytes: progress.totalBytesWritten,
        totalBytes: progress.totalBytesExpectedToWrite > 0 ? progress.totalBytesExpectedToWrite : model.sizeBytes });
    });
    try {
      const result = await download.downloadAsync();
      if (!result || result.status < 200 || result.status >= 300) throw new Error('Model download failed');
      const info = await FileSystem.getInfoAsync(part);
      if (!info.exists || info.isDirectory || info.size < model.sizeBytes * 0.9) {
        throw new Error('Incomplete model download (less than 90% of expected size)');
      }
      await FileSystem.deleteAsync(path, { idempotent: true });
      await FileSystem.moveAsync({ from: part, to: path });
      onProgress?.({ modelId: id, receivedBytes: info.size, totalBytes: info.size });
    } catch (error) {
      await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => undefined);
      throw error;
    }
  }),
  deleteModel: (id) => serial(async () => {
    const path = modelPath(id);
    if (loadedId === id) await release();
    await FileSystem.deleteAsync(path, { idempotent: true });
    await FileSystem.deleteAsync(`${path}.part`, { idempotent: true });
  }),
  load: (id) => serial(async () => {
    getModel(id);
    if (loadedId === id && context) return;
    if (!await ready(id)) throw new Error(`Model is not downloaded: ${id}`);
    await release();
    context = await initWhisper({ filePath: modelPath(id) });
    loadedId = id;
  }),
  transcribeChunk: (chunk, { prompt }) => serial(async () => {
    if (!context) throw new Error('Load a transcription model first');
    if (!chunk.localPath) throw new Error('Audio chunk has no local path');
    // transcribeData accepts float32 PCM, but installed APIs do not expose an
    // offline m4a-to-PCM decoder. Use the previous text prompt, not audio overlap.
    // Integration limitation: 0.7.4's readWaveAudio only reads 16-bit PCM WAV;
    // the recorder's m4a needs a decoder or a recording-format change upstream.
    const result = await context.transcribe(chunk.localPath, {
      language: 'ko', prompt, maxLen: 0, tokenTimestamps: true,
    }).promise;
    if (result.isAborted) throw new Error('Transcription was aborted');
    return result.segments.map(({ text, t0, t1 }) => ({
      text, startMs: whisperTicksToMs(t0), endMs: whisperTicksToMs(t1),
    }));
  }),
};

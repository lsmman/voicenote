import * as FileSystem from 'expo-file-system/legacy';
// 0.7.4 exports only subpaths (no "." entry); /index resolves its installed types.
import { initWhisper, type WhisperContext } from 'whisper.rn/index';
import { decodeAudioData, getAudioDuration } from 'react-native-audio-api';
import { overlapTail, pcmWindows, SAMPLE_RATE, WINDOW_MS, whisperTicksToMs } from './audio';
import { getModel, listModels } from './models';
import { createSerialQueue } from './serial';
import { resolveLocalPath } from '../recorder/paths';
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
  transcribeChunk: (rawChunk, { prompt, prevChunk: rawPrev, language }) => serial(async () => {
    const chunk = rawChunk.localPath ? { ...rawChunk, localPath: resolveLocalPath(rawChunk.localPath) } : rawChunk;
    const prevChunk = rawPrev?.localPath ? { ...rawPrev, localPath: resolveLocalPath(rawPrev.localPath) } : rawPrev;
    if (!context) throw new Error('Load a transcription model first');
    if (!chunk.localPath) throw new Error('Audio chunk has no local path');
    const options = { language, prompt, maxLen: 0, tokenTimestamps: true };
    const mapResult = (result: Awaited<ReturnType<WhisperContext['transcribeData']>['promise']>, startMs: number) => {
      if (result.isAborted) throw new Error('Transcription was aborted');
      return result.segments.map(({ text, t0, t1 }) => ({
        text, startMs: whisperTicksToMs(t0) + startMs, endMs: whisperTicksToMs(t1) + startMs,
      }));
    };

    // 0.13.6 exposes no seek/range decode (AudioDecoder.d.ts / IAudioDecoder).
    // For long WAV imports without overlap, avoid the extra JS decoded copy.
    // Whisper's file reader still allocates native audio and requires PCM16 WAV.
    // Metadata probing avoids decoding just to discover that a WAV is long.
    if (!prevChunk && /\.wav(?:[?#]|$)/i.test(chunk.localPath)) {
      const duration = await getAudioDuration(chunk.localPath).catch(() => chunk.durationMs / 1000);
      if (duration * 1000 > WINDOW_MS) {
        return mapResult(await context.transcribe(chunk.localPath, options).promise, 0);
      }
    }

    const decode = async (path: string) => {
      const audio = await decodeAudioData(path, SAMPLE_RATE);
      if (audio.sampleRate !== SAMPLE_RATE) throw new Error('Audio decoder did not resample to 16 kHz');
      return audio;
    };
    // Decode the previous file first and retain only its mono tail, never both
    // full decoded files. The helper scopes release native buffers before inference.
    const previousTail = async () => {
      if (!prevChunk) return undefined;
      if (!prevChunk.localPath) throw new Error('Previous audio chunk has no local path');
      return overlapTail(await decode(prevChunk.localPath));
    };
    const prepare = async () => {
      const tail = await previousTail();
      return pcmWindows(await decode(chunk.localPath!), tail);
    };
    // Compressed inputs must decode in full with this installed API. Immediately
    // copy ranges into <=10-minute mono PCM16 windows, then drop the decoded
    // buffer before inference. This halves retained sample storage vs Float32;
    // it cannot eliminate the initial native decode peak (or guarantee no OOM).
    // Each consumed window is removed, so no full Float32/PCM duplicate persists.
    const windows = await prepare();
    const segments: { text: string; startMs: number; endMs: number }[] = [];
    while (windows.length) {
      const window = windows.shift()!;
      // index.d.ts incorrectly says float32: RNWhisperJSI.cpp's
      // whisperTranscribeData -> requireAudioBufferArgument -> decodePcm16
      // consumes raw PCM16, mono, 16 kHz (no WAV header or base64 needed).
      const result = await context.transcribeData(window.data, options).promise;
      segments.push(...mapResult(result, window.startMs));
    }
    return segments;
  }),
};

import { store } from '../store';
import type { AudioChunk } from '../core/types';
import { buildMp4aSampleEntry, concatM4a, muxAac, type AacSample } from './mp4';
import { muxWav, pcm16 } from './wav';
import { audioExtension, isMp4, safeTitle } from './common';

async function getBlob(chunk: AudioChunk): Promise<Blob> {
  if (!chunk.localPath || !store.getAudioBlob) throw new Error(`Audio chunk ${chunk.seq} is not available locally`);
  const blob = await store.getAudioBlob(chunk.localPath);
  if (!blob?.size) throw new Error(`Audio chunk ${chunk.seq} is missing or empty`);
  return blob;
}
function download(blob: Blob, name: string) {
  const uri = URL.createObjectURL(blob); const link = document.createElement('a');
  try { link.href = uri; link.download = name; document.body.appendChild(link); link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(uri), 1000); }
}
function outputBlob(parts: Uint8Array[], type: string): Blob {
  // Blob accepts ArrayBuffer-backed views. Copy only unusual shared-buffer inputs.
  return new Blob(parts.map(p => p.buffer instanceof ArrayBuffer ? p as Uint8Array<ArrayBuffer> : new Uint8Array(p)), { type });
}
function mono(buffer: AudioBuffer): Float32Array<ArrayBuffer> {
  const result = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    for (let i = 0; i < result.length; i++) result[i] += source[i] / buffer.numberOfChannels;
  } return result;
}
async function transcode(chunks: AudioChunk[], onProgress?: (p: number) => void): Promise<{ blob: Blob; extension: string }> {
  const context = new AudioContext({ sampleRate: 48000 });
  let encoder: AudioEncoder | undefined;
  try {
    const rate = context.sampleRate;
    const config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: rate, numberOfChannels: 1, bitrate: 64000, aac: { format: 'aac' } };
    let supported = false;
    if (typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined' && (rate === 48000 || rate === 44100)) {
      try { supported = !!(await AudioEncoder.isConfigSupported(config)).supported; } catch { /* Unsupported codec: WAV. */ }
    }
    const samples: AacSample[] = []; const pcm: Uint8Array[] = [];
    let asc: Uint8Array | undefined, failure: Error | undefined, frames = 0;
    if (supported) {
      encoder = new AudioEncoder({
        error: error => { failure = error; },
        output: (chunk, metadata) => {
          const description = metadata?.decoderConfig?.description;
          if (description) {
            const next = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength).slice() : new Uint8Array(description).slice();
            if (asc && (next.length !== asc.length || next.some((v, i) => v !== asc![i]))) failure = new Error('AAC encoder changed configuration');
            asc = next;
          }
          const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
          // AAC-LC access units contain 1024 PCM frames. Microsecond durations are rounded.
          samples.push({ data, duration: chunk.duration ? Math.round(chunk.duration * rate / 1e6) : 1024 });
        },
      }); encoder.configure(config);
    }
    for (let i = 0; i < chunks.length; i++) {
      const decoded = await context.decodeAudioData(await (await getBlob(chunks[i])).arrayBuffer());
      if (decoded.sampleRate !== rate) throw new Error('Decoded audio sample rate changed');
      const data = mono(decoded);
      if (encoder) {
        for (let at = 0; at < data.length; at += 1024) {
          if (failure) throw failure;
          const slice = data.subarray(at, Math.min(at + 1024, data.length));
          const frame = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfChannels: 1, numberOfFrames: slice.length, timestamp: Math.round((frames + at) * 1e6 / rate), data: slice });
          try { encoder.encode(frame); } finally { frame.close(); }
          // Yield without flushing: flush at every chunk would introduce AAC padding at joins.
          while (encoder.encodeQueueSize > 32) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (failure) throw failure; }
        }
      } else { pcm.push(pcm16(data)); }
      frames += data.length; onProgress?.((i + 1) / chunks.length);
    }
    if (!encoder) return { blob: outputBlob(muxWav(pcm, rate), 'audio/wav'), extension: 'wav' };
    await encoder.flush(); if (failure) throw failure;
    if (!asc || !samples.length) throw new Error('AAC encoder returned no audio/configuration');
    return { blob: outputBlob(muxAac({ sampleEntry: buildMp4aSampleEntry(asc, rate), timescale: rate, samples }), 'audio/mp4'), extension: 'm4a' };
  } finally { if (encoder && encoder.state !== 'closed') encoder.close(); await context.close(); }
}
/**
 * Export local chunks in seq order. Progress is 0..1 for processed input chunks;
 * completion means a download was triggered, not that the browser saved the file.
 * Single chunks retain their original format because AudioChunk has no import flag.
 * Multi-chunk MP4 must be non-fragmented with identical raw AAC sample entries.
 * WebM decoding is chunkwise; the final compressed/PCM output remains in memory.
 */
export async function exportNoteAudio(noteId: string, title: string, onProgress?: (p: number) => void): Promise<void> {
  const chunks = (await store.listChunks(noteId)).slice().sort((a, b) => a.seq - b.seq);
  if (!chunks.length) throw new Error('This note has no audio to export');
  onProgress?.(0); const name = safeTitle(title);
  // The store has no import marker: one-chunk imports and recordings are indistinguishable.
  // Preserve every single-chunk original, including imported MP3/WAV/MP4/WebM.
  if (chunks.length === 1) {
    const blob = await getBlob(chunks[0]); onProgress?.(1);
    download(blob, `${name}.${audioExtension(blob.type || chunks[0].mimeType)}`); return;
  }
  if (chunks.every(c => isMp4(c.mimeType))) {
    const files: Uint8Array[] = [];
    for (let i = 0; i < chunks.length; i++) { files.push(new Uint8Array(await (await getBlob(chunks[i])).arrayBuffer())); onProgress?.((i + 1) / chunks.length); }
    download(outputBlob(concatM4a(files), 'audio/mp4'), `${name}.m4a`); return;
  }
  const output = await transcode(chunks, onProgress); download(output.blob, `${name}.${output.extension}`);
}

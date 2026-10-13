import { OVERLAP_MS } from '../core/types';

export const SAMPLE_RATE = 16_000;
export const secondsToMs = (seconds: number): number => Math.round(seconds * 1000);
export const whisperTicksToMs = (ticks: number): number => ticks * 10;

export function downmix(channels: readonly Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (channels.some((channel) => channel.length !== length)) throw new Error('Channel lengths differ');
  const mono = new Float32Array(length);
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  }
  return mono;
}

export function concatAudio(a: Float32Array, b: Float32Array): Float32Array {
  const result = new Float32Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

export function prependOverlap(current: Float32Array, previous?: Float32Array, sampleRate = SAMPLE_RATE) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate');
  const count = Math.min(previous?.length ?? 0, Math.floor(sampleRate * OVERLAP_MS / 1000));
  const tail = previous ? previous.subarray(previous.length - count) : new Float32Array(0);
  return { audio: concatAudio(tail, current), overlapMs: count * 1000 / sampleRate };
}

export function mapWebSegments(
  chunks: readonly { text: string; timestamp: readonly [number | null, number | null] }[],
  durationMs: number,
  overlapMs: number,
) {
  return chunks.map(({ text, timestamp: [start, end] }) => ({
    text,
    startMs: secondsToMs(start ?? 0) - overlapMs,
    endMs: (end == null ? durationMs : secondsToMs(end)) - overlapMs,
  }));
}

export const WINDOW_MS = 10 * 60 * 1000;

/** Raw signed PCM16, little endian, without a WAV header. */
export function toPcm16(audio: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(audio.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < audio.length; i++) {
    const sample = Number.isNaN(audio[i]) ? 0 : Math.max(-1, Math.min(1, audio[i]));
    view.setInt16(i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}

// Structural input keeps these helpers independent of native modules in Jest/web.
interface DecodedAudio {
  length: number;
  numberOfChannels: number;
  copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, start?: number): void;
}

/** Copies only the requested range; getChannelData can copy a whole native channel. */
export function downmixRange(audio: DecodedAudio, start: number, end: number): Float32Array<ArrayBuffer> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > audio.length) {
    throw new Error('Invalid audio range');
  }
  if (audio.numberOfChannels < 1) throw new Error('Audio has no channels');
  const mono = new Float32Array(end - start);
  if (!mono.length) return mono;
  const channel = new Float32Array(mono.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    audio.copyFromChannel(channel, c, start);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / audio.numberOfChannels;
  }
  return mono;
}

export function overlapTail(audio: DecodedAudio): Float32Array<ArrayBuffer> {
  return downmixRange(audio, Math.max(0, audio.length - SAMPLE_RATE * OVERLAP_MS / 1000), audio.length);
}

export interface PcmWindow { data: ArrayBuffer; startMs: number }

/** Compact immediately, retaining no full-length Float32 channels or native buffer. */
export function pcmWindows(audio: DecodedAudio, previous?: Float32Array): PcmWindow[] {
  const windows: PcmWindow[] = [];
  const limit = SAMPLE_RATE * WINDOW_MS / 1000;
  const tail = previous?.subarray(Math.max(0, previous.length - SAMPLE_RATE * OVERLAP_MS / 1000));
  const overlap = tail?.length ?? 0;
  for (let start = 0; start < audio.length;) {
    const prefix = start === 0 ? overlap : 0;
    const end = Math.min(audio.length, start + limit - prefix);
    const mono = downmixRange(audio, start, end);
    windows.push({
      data: toPcm16(prefix ? concatAudio(tail!, mono) : mono),
      startMs: (start - prefix) * 1000 / SAMPLE_RATE,
    });
    start = end;
  }
  return windows;
}

/** Linear interpolation at the decoder's actual rate, independent of browser rate hints. */
export function resample(audio: Float32Array, fromRate: number, toRate = SAMPLE_RATE): Float32Array {
  if (![fromRate, toRate].every((rate) => Number.isFinite(rate) && rate > 0)) {
    throw new Error('Invalid sample rate');
  }
  if (fromRate === toRate) return audio;
  const output = new Float32Array(Math.round(audio.length * toRate / fromRate));
  for (let i = 0; i < output.length; i++) {
    const position = i * fromRate / toRate;
    const left = Math.min(Math.floor(position), audio.length - 1);
    const right = Math.min(left + 1, audio.length - 1);
    output[i] = audio[left] + (audio[right] - audio[left]) * (position - left);
  }
  return output;
}

/** Allocate only the next transferable window; never transfer the full recording. */
export function* webAudioWindows(current: Float32Array, previous?: Float32Array) {
  const limit = SAMPLE_RATE * WINDOW_MS / 1000;
  const overlap = SAMPLE_RATE * OVERLAP_MS / 1000;
  const tail = previous?.subarray(Math.max(0, previous.length - overlap));
  for (let start = 0; start < current.length;) {
    const prefix = start === 0 ? tail?.length ?? 0 : overlap;
    const end = Math.min(current.length, start + limit - prefix);
    const audio = start === 0 && prefix
      ? concatAudio(tail!, current.subarray(start, end))
      : current.slice(start - prefix, end);
    yield { audio, startMs: (start - prefix) * 1000 / SAMPLE_RATE };
    start = end;
  }
}

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

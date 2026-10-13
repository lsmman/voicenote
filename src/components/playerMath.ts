import type { AudioChunk, Segment } from '../core/types';
export function timelineDuration(chunks: AudioChunk[]): number {
  return chunks.reduce((end, c) => Math.max(end, c.startMs + Math.max(0, c.durationMs)), 0);
}
// Boundary positions belong to the following chunk; gaps snap forward.
export function chunkAtTime(chunks: AudioChunk[], ms: number): { chunk: AudioChunk; index: number; offsetMs: number } | null {
  if (!chunks.length) return null;
  const time = Math.max(0, Number.isFinite(ms) ? ms : 0);
  let index = chunks.findIndex(c => time < c.startMs + c.durationMs);
  if (index < 0) index = chunks.length - 1;
  const chunk = chunks[index];
  return { chunk, index, offsetMs: Math.max(0, Math.min(chunk.durationMs, time - chunk.startMs)) };
}
export function segmentAtTime(segments: Segment[], ms: number): Segment | null {
  // Choose the latest start in overlapping transcripts; end is exclusive.
  let found: Segment | null = null;
  for (const segment of segments) {
    if (segment.startMs <= ms && ms < segment.endMs && (!found || segment.startMs >= found.startMs)) found = segment;
  }
  return found;
}

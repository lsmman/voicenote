import type { AudioChunk, Segment } from '../core/types';
export type ReportedDurations = Readonly<Record<number, number>>;
export function chunkDuration(chunk: AudioChunk, reported: ReportedDurations = {}): number {
  return Math.max(0, chunk.durationMs || reported[chunk.seq] || 0);
}
export function timelineDuration(chunks: AudioChunk[], reported: ReportedDurations = {}): number {
  return chunks.reduce((end, c) => Math.max(end, c.startMs + chunkDuration(c, reported)), 0);
}
export function chunkByIndex(chunks: AudioChunk[], index: number) {
  const chunk = chunks[index];
  return chunk ? { chunk, index, offsetMs: 0 } : null;
}
// Latest start wins at boundaries and in overlaps. Gaps clamp to the previous end.
export function chunkAtTime(chunks: AudioChunk[], ms: number, reported: ReportedDurations = {}): { chunk: AudioChunk; index: number; offsetMs: number } | null {
  if (!chunks.length) return null;
  const time = Math.max(0, Number.isFinite(ms) ? ms : 0);
  let lo = 0; let hi = chunks.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (chunks[mid].startMs <= time) lo = mid + 1; else hi = mid; }
  const index = Math.max(0, lo - 1); const chunk = chunks[index];
  const duration = chunkDuration(chunk, reported);
  return { chunk, index, offsetMs: Math.max(0, duration > 0 ? Math.min(duration, time - chunk.startMs) : time - chunk.startMs) };
}
export function sourceIsReady(status: { id: string; isLoaded: boolean; duration: number }, playerId: string, sourceGeneration: number, currentGeneration: number): boolean {
  return sourceGeneration === currentGeneration && status.id === playerId && status.isLoaded && Number.isFinite(status.duration) && status.duration > 0;
}
export function segmentAtTime(segments: Segment[], ms: number): Segment | null {
  let lo = 0; let hi = segments.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (segments[mid].startMs <= ms) lo = mid + 1; else hi = mid; }
  const segment = segments[lo - 1];
  return segment && ms < segment.endMs ? segment : null;
}

import { OVERLAP_MS, type Segment } from '../core/types';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** Engine timestamps already account for the prepended audio (and may be negative). */
export function mergeSegments(
  existing: Segment[],
  incoming: { startMs: number; endMs: number; text: string }[],
  chunkStartMs: number,
  noteId: string,
  newId: () => string,
): Segment[] {
  const merged = [...existing];
  const boundary = existing[existing.length - 1]?.endMs ?? 0;
  for (const item of [...incoming].sort((a, b) => a.startMs - b.startMs)) {
    const start = chunkStartMs + item.startMs;
    const end = chunkStartMs + item.endMs;
    const text = normalize(item.text);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < boundary - 300) continue;
    const previous = merged[merged.length - 1];
    if (previous && start <= chunkStartMs + OVERLAP_MS && end <= chunkStartMs + OVERLAP_MS && end >= chunkStartMs - OVERLAP_MS &&
        start <= previous.endMs + 300 && normalize(previous.text).endsWith(text)) continue;
    const startMs = Math.max(0, start, previous?.endMs ?? 0);
    if (end <= startMs) continue;
    merged.push({ id: newId(), noteId, startMs, endMs: end, text: item.text, speakerLabel: null, edited: false });
  }
  return merged;
}

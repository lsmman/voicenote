import { OVERLAP_MS, type Segment } from '../core/types';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

/** Overlapping windows re-hear the last words of the previous window. Return
 * `next` without its leading words when they repeat the end of `prev`: either
 * two or more exact words, or a cut-off tail of prev's preceding word followed
 * by at least one exact word ("줄이는 방법과" + "이는 방법과 ..."). */
export function stripRepeatedPrefix(prev: string, next: string): string {
  const prevWords = prev.trim().split(/\s+/).map(normalize);
  const nextRaw = next.trim().split(/\s+/);
  const nextWords = nextRaw.map(normalize);
  for (let k = Math.min(6, prevWords.length, nextWords.length); k >= 1; k--) {
    const tail = prevWords.slice(prevWords.length - k);
    for (const skip of [0, 1]) {
      if (skip === 0 && k < 2) continue;
      const head = nextWords.slice(skip, skip + k);
      if (head.length < k || head.some((word, i) => !word || word !== tail[i])) continue;
      if (skip === 1) {
        const cut = nextWords[0];
        const before = prevWords[prevWords.length - k - 1];
        if (!cut || !before || cut.length < 2 || cut === before || !before.endsWith(cut)) continue;
      }
      return nextRaw.slice(skip + k).join(' ');
    }
  }
  return next;
}

/** Engine timestamps already account for the prepended audio (and may be negative). */
export function mergeSegments(
  existing: Segment[],
  incoming: { startMs: number; endMs: number; text: string }[],
  chunkStartMs: number,
  noteId: string,
  newId: () => string,
  seq?: number,
): Segment[] {
  const merged = [...existing];
  const ordered = incoming.map((item, index) => ({ item, index })).sort((a, b) => a.item.startMs - b.item.startMs);
  // The previous chunk ends mid-word; this chunk re-heard the boundary with
  // OVERLAP_MS of context, so its first segment wins over a cut-off tail.
  const first = ordered[0]?.item;
  const last = merged[merged.length - 1];
  if (first && last && !last.edited && first.startMs < 0 && normalize(first.text)) {
    const firstEnd = Math.round(chunkStartMs + first.endMs);
    const cutOff = !/[.?!。]\s*$/.test(last.text);
    if (cutOff && last.startMs >= chunkStartMs - OVERLAP_MS - 1000 && last.endMs <= chunkStartMs + 300) {
      merged[merged.length - 1] = { ...last, endMs: Math.max(last.endMs, firstEnd), text: first.text };
      ordered.shift();
    } else {
      const sentences = last.text.trim().split(/(?<=[.?!。])\s+/);
      const tail = sentences[sentences.length - 1] ?? '';
      const head = normalize(tail).slice(0, 4);
      if (sentences.length > 1 && head.length >= 2 && normalize(first.text).startsWith(head)) {
        merged[merged.length - 1] = { ...last, text: last.text.slice(0, last.text.lastIndexOf(tail)).trimEnd(), endMs: Math.min(last.endMs, Math.round(chunkStartMs + first.startMs)) };
      }
    }
  }
  const boundary = merged[merged.length - 1]?.endMs ?? 0;
  for (const { item, index } of ordered) {
    const start = Math.round(chunkStartMs + item.startMs);
    const end = Math.round(chunkStartMs + item.endMs);
    const text = normalize(item.text);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end < boundary - 300) continue;
    const midpoint = (start + end) / 2;
    if (merged.some(segment => midpoint >= segment.startMs && midpoint <= segment.endMs)) continue;
    const previous = merged[merged.length - 1];
    if (previous && start <= chunkStartMs + OVERLAP_MS && end <= chunkStartMs + OVERLAP_MS && end >= chunkStartMs - OVERLAP_MS &&
        start <= previous.endMs + 300 && normalize(previous.text).endsWith(text)) continue;
    let itemText = item.text;
    if (previous && start < previous.endMs) {
      itemText = stripRepeatedPrefix(previous.text, item.text);
      if (!normalize(itemText)) continue;
    }
    const startMs = Math.max(0, start, previous?.endMs ?? 0);
    if (end <= startMs) continue;
    merged.push({ id: seq === undefined ? newId() : `${noteId}:${seq}:${index}`, noteId, startMs, endMs: end, text: itemText === item.text ? item.text : ` ${itemText}`, speakerLabel: null, edited: false });
  }
  return merged;
}

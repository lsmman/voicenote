import type { Memo, Segment, Summary } from '../core/types';
import { formatTime, formatTimestamp } from './format';

const duration = (ms: number) => Number.isFinite(ms) ? Math.max(0, ms) : 0;
export interface SpeechBucket { startMs: number; endMs: number; characters: number }
export function speechBuckets(segments: Segment[], durationMs: number): SpeechBucket[] {
  const end = duration(durationMs);
  if (!end) return [];
  // ~40 columns for any length; 5s floor keeps very short notes from becoming noise.
  const size = Math.max(5_000, end / 40);
  const buckets = Array.from({ length: Math.min(40, Math.ceil(end / size)) }, (_, i) => ({
    startMs: i * size, endMs: Math.min(end, (i + 1) * size), characters: 0,
  }));
  for (const segment of segments) {
    if (!Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.endMs < segment.startMs) continue;
    const chars = Array.from(segment.text).length;
    if (segment.endMs === segment.startMs) {
      if (segment.startMs >= 0 && segment.startMs <= end) buckets[Math.min(buckets.length - 1, Math.floor(segment.startMs / size))].characters += chars;
      continue;
    }
    for (const bucket of buckets) {
      const overlap = Math.max(0, Math.min(bucket.endMs, segment.endMs) - Math.max(bucket.startMs, segment.startMs));
      bucket.characters += chars * overlap / (segment.endMs - segment.startMs);
    }
  }
  return buckets;
}

const normalize = (text: string) => text.normalize('NFC').toLowerCase().replace(/\s+/gu, '');
export function keywordCounts(keywords: string[], segments: Segment[]) {
  const transcript = normalize(segments.map(segment => segment.text).join(' '));
  return keywords.map((keyword, order) => {
    const needle = normalize(keyword);
    let count = 0;
    if (needle) {
      let at = transcript.indexOf(needle);
      while (at !== -1) { count++; at = transcript.indexOf(needle, at + needle.length); }
    }
    return { keyword, count: Math.max(1, count), order };
  }).sort((a, b) => b.count - a.count || a.order - b.order).slice(0, 10);
}

export function summaryStatValues(durationMs: number, segments: Segment[], summary: Summary, memos: Memo[]) {
  const ms = duration(durationMs);
  return [
    { label: '녹음 길이', value: ms >= 3_600_000 ? formatTime(ms) : formatTimestamp(ms) },
    { label: '문장 수', value: String(segments.length) },
    { label: '할 일', value: String(summary.todos.length) },
    { label: '메모', value: String(memos.length) },
  ];
}
export interface SummaryMarker { id: string; kind: 'point' | 'todo' | 'memo'; text: string; atMs: number; fraction: number; number?: number }
export function summaryMarkers(summary: Summary, memos: Memo[], durationMs: number): SummaryMarker[] {
  const end = duration(durationMs);
  const markers: SummaryMarker[] = [];
  const add = (id: string, kind: SummaryMarker['kind'], text: string, ms: number | null, number?: number) => {
    if (ms === null || !Number.isFinite(ms)) return;
    const atMs = Math.max(0, Math.min(end, ms));
    markers.push({ id, kind, text, atMs, fraction: end ? atMs / end : 0, number });
  };
  summary.summary.forEach((item, i) => add(`point-${i}`, 'point', item.text, item.atMs, i + 1));
  summary.todos.forEach((item, i) => add(`todo-${i}`, 'todo', item.text, item.atMs));
  memos.forEach((memo, i) => add(`memo-${i}`, 'memo', memo.text || (memo.kind === 'bookmark' ? '북마크' : '메모'), memo.atMs));
  return markers;
}

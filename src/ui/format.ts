import type { Memo, Note, Segment, Summary } from '../core/types';
const seconds = (ms: number) => Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
const pad = (n: number) => String(n).padStart(2, '0');
export function formatTime(ms: number): string {
  const s = seconds(ms);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
export function formatTimestamp(ms: number): string {
  const s = seconds(ms);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}
export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}
export function statusLabel(status: Note['status'], progress?: { done: number; total: number }): string {
  if (status === 'transcribing' && progress && progress.total > 0) return `전사 중 ${Math.round(Math.max(0, Math.min(1, progress.done / progress.total)) * 100)}%`;
  return { recording: '녹음 중', transcribing: '전사 중', summarizing: '요약 중', done: '완료', error: '오류' }[status];
}
export interface ExportNote { note: Note; summary: Summary | null; segments: Segment[]; memos: Memo[] }
const escapeMd = (text: string) => text.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1');
export function buildExport(data: ExportNote, format: 'txt' | 'md'): string {
  const md = format === 'md';
  const text = (s: string) => md ? escapeMd(s) : s;
  const heading = (s: string) => `${md ? '## ' : ''}${s}`;
  const items = (entries: { text: string; atMs: number | null }[]) => entries.map(item => `${md ? '- ' : ''}${item.atMs === null ? '' : `[${formatTimestamp(item.atMs)}] `}${text(item.text)}`).join('\n');
  return [ `${md ? '# ' : ''}${text(data.note.title)}`, `${data.note.createdAt} · ${formatTime(data.note.durationMs)}`,
    heading('요약'), data.summary ? items(data.summary.summary) : '요약 없음',
    heading('키워드'), data.summary?.keywords.map(text).join(', ') || '없음',
    heading('할 일'), data.summary ? items(data.summary.todos) : '없음',
    heading('전사문'), [...data.segments].sort((a, b) => a.startMs - b.startMs).map(s => `[${formatTimestamp(s.startMs)}] ${s.speakerLabel ? `(${text(s.speakerLabel)}) ` : ''}${text(s.text)}`).join('\n'),
    heading('메모'), [...data.memos].sort((a, b) => a.atMs - b.atMs).map(m => `[${formatTimestamp(m.atMs)}] ${m.kind === 'bookmark' ? '북마크' : text(m.text)}`).join('\n'),
  ].join('\n\n') + '\n';
}
export const buildTextExport = (data: ExportNote) => buildExport(data, 'txt');
export const buildMarkdownExport = (data: ExportNote) => buildExport(data, 'md');

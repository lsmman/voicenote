import type { Memo, Note, Segment, Summary } from '../core/types';
import { t } from '../i18n';
import { getLanguage } from '../i18n/language';
export const getLocale = () => ({ ko: 'ko-KR', en: 'en-US', zh: 'zh-CN' } as const)[getLanguage()];
const numberFormats = new Map<string, Intl.NumberFormat>();
const seconds = (ms: number) => Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
// Keep elapsed time as a clock (including total minutes), using locale digits.
const pad = (n: number) => {
  const locale = getLocale();
  let formatter = numberFormats.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumIntegerDigits: 2, useGrouping: false });
    numberFormats.set(locale, formatter);
  }
  return formatter.format(n);
};
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
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}
export function statusLabel(status: Note['status'], progress?: { done: number; total: number }): string {
  if (status === 'transcribing' && progress && progress.total > 0) return t('transcriptionProgress', { p0: Math.round(Math.max(0, Math.min(1, progress.done / progress.total)) * 100) });
  return { recording: t('recording'), transcribing: t('transcribing'), summarizing: t('summarizing'), done: t('done'), error: t('error') }[status];
}
export interface ExportNote { note: Note; summary: Summary | null; segments: Segment[]; memos: Memo[] }
const escapeMd = (text: string) => text.replace(/([\\`*_{}\[\]<>#+.!|~-])/g, '\\$1');
export function buildExport(data: ExportNote, format: 'txt' | 'md'): string {
  const md = format === 'md';
  const text = (s: string) => md ? escapeMd(s) : s;
  const heading = (s: string) => `${md ? '## ' : ''}${s}`;
  const items = (entries: { text: string; atMs: number | null }[]) => entries.map(item => `${md ? '- ' : ''}${item.atMs === null ? '' : `[${formatTimestamp(item.atMs)}] `}${text(item.text)}`).join('\n');
  return [ `${md ? '# ' : ''}${text(data.note.title)}`, `${data.note.createdAt} · ${formatTime(data.note.durationMs)}`,
    heading(t('summary')), data.summary ? items(data.summary.summary) : t('noSummary'),
    heading(t('keywords')), data.summary?.keywords.map(text).join(', ') || t('none'),
    heading(t('todos')), data.summary ? items(data.summary.todos) : t('none'),
    heading(t('transcript')), [...data.segments].sort((a, b) => a.startMs - b.startMs).map(s => `[${formatTimestamp(s.startMs)}] ${s.speakerLabel ? `(${text(s.speakerLabel)}) ` : ''}${text(s.text)}`).join('\n'),
    heading(t('memo')), [...data.memos].sort((a, b) => a.atMs - b.atMs).map(m => `[${formatTimestamp(m.atMs)}] ${m.kind === 'bookmark' ? t('bookmark') : text(m.text)}`).join('\n'),
  ].join('\n\n') + '\n';
}
export const buildTextExport = (data: ExportNote) => buildExport(data, 'txt');
export const buildMarkdownExport = (data: ExportNote) => buildExport(data, 'md');

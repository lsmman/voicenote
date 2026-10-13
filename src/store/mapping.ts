import type { Note, Segment, Summary } from '../core/types';

export type NoteRow = Omit<Note, 'gaps'> & { gaps: string };
export type SegmentRow = Omit<Segment, 'edited'> & { edited: number };
export type SummaryRow = Omit<Summary, 'summary' | 'keywords' | 'todos'> & {
  summary: string; keywords: string; todos: string;
};
function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

export const noteFromRow = (row: NoteRow): Note => ({ ...row, gaps: parseJson<Note['gaps']>(row.gaps, []) });
export const segmentFromRow = (row: SegmentRow): Segment => ({ ...row, edited: row.edited !== 0 });
export const summaryFromRow = (row: SummaryRow): Summary => ({
  ...row, summary: parseJson<Summary['summary']>(row.summary, []), keywords: parseJson<Summary['keywords']>(row.keywords, []), todos: parseJson<Summary['todos']>(row.todos, []),
});

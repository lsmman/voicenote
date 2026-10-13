import type { Note, Segment, Summary } from '../core/types';

export type NoteRow = Omit<Note, 'gaps'> & { gaps: string };
export type SegmentRow = Omit<Segment, 'edited'> & { edited: number };
export type SummaryRow = Omit<Summary, 'summary' | 'keywords' | 'todos'> & {
  summary: string; keywords: string; todos: string;
};
export const noteFromRow = (row: NoteRow): Note => ({ ...row, gaps: JSON.parse(row.gaps) });
export const segmentFromRow = (row: SegmentRow): Segment => ({ ...row, edited: row.edited !== 0 });
export const summaryFromRow = (row: SummaryRow): Summary => ({
  ...row, summary: JSON.parse(row.summary), keywords: JSON.parse(row.keywords), todos: JSON.parse(row.todos),
});

import { noteFromRow, summaryFromRow, type NoteRow, type SummaryRow } from '../mapping';

test('malformed JSON falls back per field without discarding other rows or valid fields', () => {
  const notes = [{ id: 'bad', gaps: '{' }, { id: 'good', gaps: '[{"atMs":1,"reason":"call"}]' }] as NoteRow[];
  expect(notes.map(noteFromRow).map(note => note.gaps)).toEqual([[], [{ atMs: 1, reason: 'call' }]]);
  expect(summaryFromRow({ noteId: 'a', summary: '{', keywords: '["valid"]', todos: 'null', createdAt: 'now' } as SummaryRow))
    .toEqual({ noteId: 'a', summary: [], keywords: ['valid'], todos: [], createdAt: 'now' });
});

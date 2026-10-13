import { buildMarkdownExport, buildTextExport, formatTime, formatTimestamp, statusLabel } from '../format';
import type { ExportNote } from '../format';
const data: ExportNote = {
  note: { id: 'n', title: '회의 *노트*', userId: null, createdAt: '2026-10-13T00:00:00Z', durationMs: 10805000, status: 'done', modelName: null, gaps: [] },
  summary: { noteId: 'n', createdAt: '', summary: [{ text: '결론', atMs: 1000 }, { text: '근거 없음', atMs: null }], keywords: ['일정'], todos: [{ text: '자료 보내기', atMs: 2000 }] },
  segments: [{ id: 's', noteId: 'n', startMs: 3661000, endMs: 3662000, text: '안녕하세요', speakerLabel: '민수', edited: true }],
  memos: [{ id: 'm', noteId: 'n', atMs: 2000, text: '', kind: 'bookmark' }, { id: 'm2', noteId: 'n', atMs: 1000, text: '중요', kind: 'memo' }],
};
test.each([[0, '00:00:00'], [999, '00:00:00'], [3661000, '01:01:01'], [10805000, '03:00:05'], [-1, '00:00:00'], [NaN, '00:00:00']])('timer handles %s', (ms, expected) => expect(formatTime(ms)).toBe(expected));
test('timestamps preserve hours as total minutes', () => { expect(formatTimestamp(3661000)).toBe('61:01'); });
test('progress is clamped and unknown total does not divide by zero', () => {
  expect(statusLabel('transcribing', { done: 1, total: 4 })).toBe('전사 중 25%');
  expect(statusLabel('transcribing', { done: 5, total: 4 })).toBe('전사 중 100%');
  expect(statusLabel('transcribing', { done: 0, total: 0 })).toBe('전사 중');
});
test('text export contains title, summary, keywords, todos, timestamped speakers and sorted memos', () => {
  const text = buildTextExport(data);
  for (const expected of ['회의 *노트*', '03:00:05', '[00:01] 결론', '근거 없음', '일정', '[00:02] 자료 보내기', '[61:01] (민수) 안녕하세요', '[00:01] 중요\n[00:02] 북마크']) expect(text).toContain(expected);
  expect(data.memos[0].id).toBe('m');
});
test('markdown export escapes user text and keeps headings', () => {
  const text = buildMarkdownExport(data);
  expect(text).toContain('# 회의 \\*노트\\*'); expect(text).toContain('## 전사문'); expect(text).toContain('- [00:01] 결론');
});
test('empty note exports without nullable summary or speaker errors', () => {
  const text = buildTextExport({ ...data, summary: null, memos: [], segments: [{ ...data.segments[0], speakerLabel: null }] });
  expect(text).toContain('요약 없음'); expect(text).not.toContain('(null)');
});

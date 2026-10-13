import { mergeSegments } from '../mergeSegments';
import type { Segment } from '../../core/types';

const seg = (id: string, startMs: number, endMs: number, text: string): Segment =>
  ({ id, noteId: 'n', startMs, endMs, text, speakerLabel: null, edited: false });
const ids = () => { let i = 0; return () => `x${i++}`; };

// Real data from a production run: chunk 0 ended with a word cut at 30s,
// chunk 1 (transcribed with 1s of overlap) heard the full sentence.
test('a cut-off fragment inside the overlap window is replaced by the next chunk', () => {
  const existing = [
    seg('a', 22340, 29140, '회의에서는 서버 비용을 줄이는 방법을 이야기했습니다.'),
    seg('b', 29140, 30000, ' 전역에는'),
  ];
  const merged = mergeSegments(existing, [{ startMs: -1000, endMs: 3560, text: ' 저녁에는 도서관에 가서 역사책을 두 권 빌렸습니다.' }], 30000, 'n', ids(), 1);
  expect(merged.map(s => s.text.trim())).toEqual([
    '회의에서는 서버 비용을 줄이는 방법을 이야기했습니다.',
    '저녁에는 도서관에 가서 역사책을 두 권 빌렸습니다.',
  ]);
  expect(merged[1].startMs).toBe(29140);
});

test('a truncated last sentence of a long segment is trimmed when the next chunk repeats it', () => {
  const existing = [seg('a', 50000, 60000, ' 맛있는 회를 먹을 계획입니다. 이 녹음은 3.5.')];
  const merged = mergeSegments(existing, [{ startMs: -800, endMs: 4000, text: ' 이 녹음은 30초 단위로 나뉘어 저장됩니다.' }], 60000, 'n', ids(), 2);
  expect(merged.map(s => s.text.trim())).toEqual([
    '맛있는 회를 먹을 계획입니다.',
    '이 녹음은 30초 단위로 나뉘어 저장됩니다.',
  ]);
});

test('segments that start well before the overlap are kept intact', () => {
  const existing = [seg('a', 20000, 29900, ' 오늘 회의는 여기까지입니다.')];
  const merged = mergeSegments(existing, [{ startMs: 500, endMs: 4000, text: ' 다음 안건으로 넘어가겠습니다.' }], 30000, 'n', ids(), 1);
  expect(merged.map(s => s.text.trim())).toEqual(['오늘 회의는 여기까지입니다.', '다음 안건으로 넘어가겠습니다.']);
});

// Real output of a 74s import split into 30s windows with 1s overlap.
test('words repeated across an overlap window are dropped from the next segment', () => {
  const merged = mergeSegments([], [
    { startMs: 22000, endMs: 25500, text: ' 회의에서는 서버 비용을 줄이는 방법과' },
    { startMs: 25000, endMs: 29000, text: ' 이는 방법과 사용자 피드백을 정리하는 방법을 이야기했습니다.' },
    { startMs: 45000, endMs: 49500, text: ' 내일은 아침 일찍 일어나서 운동을 하고 친구와 함께 커피를' },
    { startMs: 49000, endMs: 51000, text: ' 함께 커피를 마실 예정입니다.' },
  ], 0, 'n', ids(), 0);
  expect(merged.map(s => s.text.trim())).toEqual([
    '회의에서는 서버 비용을 줄이는 방법과',
    '사용자 피드백을 정리하는 방법을 이야기했습니다.',
    '내일은 아침 일찍 일어나서 운동을 하고 친구와 함께 커피를',
    '마실 예정입니다.',
  ]);
});

test('ordinary adjacent sentences are not trimmed', () => {
  const merged = mergeSegments([], [
    { startMs: 0, endMs: 3000, text: ' 회의를 시작하겠습니다.' },
    { startMs: 3000, endMs: 6000, text: ' 회의 안건은 두 가지입니다.' },
  ], 0, 'n', ids(), 0);
  expect(merged.map(s => s.text.trim())).toEqual(['회의를 시작하겠습니다.', '회의 안건은 두 가지입니다.']);
});

test('segment times are stored as whole milliseconds', () => {
  const merged = mergeSegments([], [{ startMs: 1000.375, endMs: 2500.6, text: ' 문장입니다.' }], 24333.375, 'n', ids(), 0);
  expect(Number.isInteger(merged[0].startMs) && Number.isInteger(merged[0].endMs)).toBe(true);
});

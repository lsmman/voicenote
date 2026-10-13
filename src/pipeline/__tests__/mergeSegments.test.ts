/// <reference types="jest" />
import { mergeSegments } from '../mergeSegments';
const id = () => 'id';
const existing = mergeSegments([], [{ startMs: 29_000, endMs: 30_000, text: '마지막 문장입니다.' }], 0, 'n', id);

test('relative times become absolute and overlap starts are clamped', () => {
  expect(mergeSegments(existing, [{ startMs: -200, endMs: 1500, text: '새 문장' }], 30_000, 'n', id)[1])
    .toMatchObject({ startMs: 30_000, endMs: 31_500, noteId: 'n' });
});
test('normalized duplicates of the previous tail are dropped in overlap', () => {
  expect(mergeSegments(existing, [{ startMs: -900, endMs: 200, text: '문장 입니다!' }], 30_000, 'n', id)).toEqual(existing);
});
test('old timestamps are dropped but later repeated speech is preserved', () => {
  expect(mergeSegments(existing, [
    { startMs: -1000, endMs: -400, text: 'old' },
    { startMs: 2000, endMs: 3000, text: '마지막 문장입니다.' },
  ], 30_000, 'n', id)).toHaveLength(2);
});
test('does not mutate existing input or retain invalid intervals', () => {
  expect(mergeSegments(existing, [{ startMs: 0, endMs: -100, text: 'bad' }], 30_000, 'n', id)).toEqual(existing);
  expect(existing).toHaveLength(1);
});

test('an intentional repeated segment extending beyond overlap is preserved', () => {
  expect(mergeSegments(existing, [{ startMs: 0, endMs: 4000, text: '마지막 문장입니다.' }], 30_000, 'n', id)).toHaveLength(2);
});

test('covered midpoint drops changed text and preserves an uncovered continuation', () => {
  const merged = mergeSegments(existing, [
    { startMs: -900, endMs: 100, text: '다르게 인식된 중복' },
    { startMs: -100, endMs: 2000, text: '다음 내용' },
  ], 30_000, 'n', id, 1);
  expect(merged.map(s => s.text)).toEqual(['마지막 문장입니다.', '다음 내용']);
  expect(merged[1].id).toBe('n:1:1');
});

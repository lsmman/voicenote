import { setLanguage } from '../../i18n/language';
import type { Memo, Segment, Summary } from '../../core/types';
import { keywordCounts, speechBuckets, summaryMarkers, summaryStatValues } from '../summaryStats';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await setLanguage('ko'); });
const segment = (text: string, startMs = 0, endMs = 120000): Segment => ({ id: 's', noteId: 'n', text, startMs, endMs, speakerLabel: null, edited: false });
const summary: Summary = { noteId: 'n', summary: [{ text: 'untimed', atMs: null }, { text: 'point', atMs: 30000 }], todos: [{ text: 'todo', atMs: 120000 }], keywords: [], createdAt: '' };
const memos: Memo[] = [{ id: 'm', noteId: 'n', kind: 'memo', text: 'memo', atMs: -100 }, { id: 'b', noteId: 'n', kind: 'bookmark', text: '', atMs: 60000 }];
test('distributes characters by overlap and preserves fractional contributions', () => {
  const buckets = speechBuckets([segment('가나다라마바', 30000, 90000), segment('abc', 0, 90000)], 400000);
  expect(buckets.length).toBe(40);
  expect(buckets.reduce((sum, b) => sum + b.characters, 0)).toBeCloseTo(9);
  const minute = speechBuckets([segment('a', 30000, 150000)], 2400000).map(b => b.characters);
  expect(minute.slice(0, 3)).toEqual([0.25, 0.5, 0.25]);
  expect(minute.slice(3).every(c => c === 0)).toBe(true);
});
test('caps bucket count at 40, uses a 5 second minimum, and retains partial last bucket', () => {
  for (const duration of [1, 60000, 60001, 2400000, 2400001, 987654321]) {
    const buckets = speechBuckets([], duration);
    expect(buckets.length).toBeLessThanOrEqual(40);
    expect(buckets[0].startMs).toBe(0);
    expect(buckets[buckets.length - 1].endMs).toBe(duration);
  }
  expect(speechBuckets([], 12000)).toEqual([{ startMs: 0, endMs: 5000, characters: 0 }, { startMs: 5000, endMs: 10000, characters: 0 }, { startMs: 10000, endMs: 12000, characters: 0 }]);
  expect(speechBuckets([], 73000)).toHaveLength(15);
});
test('guards zero/invalid duration and handles instantaneous, clipped and invalid segments', () => {
  for (const duration of [0, -1, NaN, Infinity]) expect(speechBuckets([segment('abc')], duration)).toEqual([]);
  expect(speechBuckets([segment('abc', 60000, 60000)], 60000).at(-1)!.characters).toBe(3);
  expect(speechBuckets([segment('abcd', -60000, 60000)], 60000).reduce((sum, b) => sum + b.characters, 0)).toBeCloseTo(2);
  expect(speechBuckets([segment('abc', 2, 1), segment('x', NaN, 1)], 60000)[0].characters).toBe(0);
});
test('counts Korean and case/space-insensitive non-overlapping matches; stable ties and minimum one', () => {
  expect(keywordCounts(['없는말', '가가', '회의', 'a b', '계획'], [segment('가가가가가 회 의 회의 AB a b 계획')]).map(({ keyword, count }) => [keyword, count])).toEqual([
    ['가가', 2], ['회의', 2], ['a b', 2], ['없는말', 1], ['계획', 1],
  ]);
  expect(keywordCounts(['aa'], [segment('aaa')])[0].count).toBe(1);
  expect(keywordCounts([' '], [segment('abc')])[0].count).toBe(1);
  expect(keywordCounts(Array.from({ length: 15 }, (_, i) => String(i)), [])).toHaveLength(10);
});
test('formats stat values including hours and counts both memo kinds', () => {
  expect(summaryStatValues(3661000, [segment('x')], summary, memos).map(stat => stat.value)).toEqual(['01:01:01', '1', '1', '2']);
  expect(summaryStatValues(61000, [], { ...summary, todos: [] }, []).map(stat => stat.value)).toEqual(['01:01', '0', '0', '0']);
  expect(summaryStatValues(-1, [], summary, [])[0].value).toBe('00:00');
});
test('excludes untimed items, preserves numbering, clamps fractions and seek times', () => {
  const markers = summaryMarkers(summary, memos, 60000);
  expect(markers.map(m => m.fraction)).toEqual([0.5, 1, 0, 1]);
  expect(markers.map(m => m.atMs)).toEqual([30000, 60000, 0, 60000]);
  expect(markers[0].number).toBe(2);
  expect(markers[3].text).toBe('북마크');
  expect(summaryMarkers(summary, memos, 0).every(m => m.fraction === 0 && m.atMs === 0)).toBe(true);
});

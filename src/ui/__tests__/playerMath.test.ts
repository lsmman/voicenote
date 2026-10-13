import { chunkAtTime, segmentAtTime, timelineDuration } from '../../components/playerMath';
import type { AudioChunk, Segment } from '../../core/types';
const chunk = (seq: number, startMs: number, durationMs: number): AudioChunk => ({ noteId: 'n', seq, startMs, durationMs, localPath: null, mimeType: 'audio/mp4', remotePath: null, uploadedAt: null, transcribedAt: null });
const chunks = [chunk(0, 0, 30000), chunk(1, 30000, 30000), chunk(2, 60000, 5000)];
test.each([[0, 0, 0], [-100, 0, 0], [29999, 0, 29999], [30000, 1, 0], [61000, 2, 1000], [65000, 2, 5000], [999999, 2, 5000], [NaN, 0, 0]])('seek %s maps to expected chunk and offset', (ms, index, offsetMs) => expect(chunkAtTime(chunks, ms)).toMatchObject({ index, offsetMs }));
test('empty timeline and missing intervals are safe', () => {
  expect(chunkAtTime([], 0)).toBeNull(); expect(timelineDuration([])).toBe(0);
  expect(chunkAtTime([chunk(0, 0, 1000), chunk(1, 2000, 1000)], 1500)).toMatchObject({ index: 1, offsetMs: 0 });
  expect(timelineDuration(chunks)).toBe(65000);
});
const segment = (id: string, startMs: number, endMs: number): Segment => ({ id, noteId: 'n', startMs, endMs, text: '', speakerLabel: null, edited: false });
test('highlight uses half-open intervals, gaps and latest overlapping start', () => {
  const segments = [segment('a', 0, 1000), segment('b', 1000, 2000), segment('c', 1500, 2500), segment('d', 3000, 4000)];
  expect(segmentAtTime(segments, 0)?.id).toBe('a'); expect(segmentAtTime(segments, 1000)?.id).toBe('b');
  expect(segmentAtTime(segments, 1500)?.id).toBe('c'); expect(segmentAtTime(segments, 2500)).toBeNull();
  expect(segmentAtTime(segments, 4000)).toBeNull(); expect(segmentAtTime([], 0)).toBeNull();
});

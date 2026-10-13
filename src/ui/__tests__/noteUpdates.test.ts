import { segmentsChanged, shouldPollNote } from '../noteUpdates';
import type { Segment } from '../../core/types';
const a: Segment = { id: 'a', noteId: 'n', startMs: 0, endMs: 1000, text: 'hello', edited: false, speakerLabel: null };
test('unchanged segment count and tail skip updates, including fresh object instances', () => {
  expect(segmentsChanged([], [])).toBe(false);
  expect(segmentsChanged([a], [{ ...a }])).toBe(false);
  expect(segmentsChanged([a], [])).toBe(true);
  expect(segmentsChanged([a], [a, { ...a, id: 'b' }])).toBe(true);
  expect(segmentsChanged([a], [{ ...a, id: 'b' }])).toBe(true);
  expect(segmentsChanged([a], [{ ...a, text: 'edited' }])).toBe(true);
});
test('only nonterminal notes poll', () => {
  for (const status of ['recording', 'transcribing', 'summarizing'] as const) expect(shouldPollNote(status)).toBe(true);
  for (const status of ['done', 'error', undefined] as const) expect(shouldPollNote(status)).toBe(false);
});

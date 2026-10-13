import { concatAudio, downmix, mapWebSegments, prependOverlap, whisperTicksToMs, secondsToMs } from '../audio';
import { getModel, listModels } from '../models';
import { createSerialQueue } from '../serial';
import { createProgressReporter } from '../web/progress';

test('downmix averages channels without mutating them', () => {
  const a = new Float32Array([1, -1, 0.5]);
  expect(Array.from(downmix([a, new Float32Array([-1, 1, 0.5])]))).toEqual([0, 0, 0.5]);
  expect(Array.from(a)).toEqual([1, -1, 0.5]);
  expect(downmix([])).toHaveLength(0);
  expect(() => downmix([a, new Float32Array(0)])).toThrow('Channel lengths');
});

test('concat preserves sample order and creates independent storage', () => {
  const a = new Float32Array([1, 2]);
  const result = concatAudio(a, new Float32Array([3]));
  result[0] = 0;
  expect(Array.from(result)).toEqual([0, 2, 3]);
  expect(a[0]).toBe(1);
});

test('overlap uses exactly the last second, or the available short tail', () => {
  const previous = new Float32Array(32_000);
  previous.fill(1, 16_000);
  const full = prependOverlap(new Float32Array([2]), previous);
  expect(full.overlapMs).toBe(1000);
  expect(full.audio).toHaveLength(16_001);
  expect(full.audio[0]).toBe(1);
  expect(full.audio[16_000]).toBe(2);
  expect(prependOverlap(new Float32Array(1), previous.subarray(0, 4000)).overlapMs).toBe(250);
  expect(prependOverlap(new Float32Array(1)).overlapMs).toBe(0);
  expect(prependOverlap(new Float32Array(1), new Float32Array(0)).audio).toHaveLength(1);
  expect(() => prependOverlap(new Float32Array(0), undefined, 0)).toThrow('sample rate');
});

test('converts timestamps and keeps overlap times negative, with a missing final end', () => {
  expect(whisperTicksToMs(125)).toBe(1250);
  expect(secondsToMs(1.234)).toBe(1234);
  expect(mapWebSegments([
    { text: '이전', timestamp: [0.2, 0.8] },
    { text: '현재', timestamp: [1.1, null] },
  ], 31_000, 1000)).toEqual([
    { text: '이전', startMs: -800, endMs: -200 },
    { text: '현재', startMs: 100, endMs: 30_000 },
  ]);
});

test('catalog rejects unknown paths and exposes the recommended default', () => {
  expect(listModels().filter((m) => m.recommended).map((m) => m.id)).toEqual(['large-v3-turbo-q5_0']);
  expect(getModel('base-q5_1').native.file).toBe('ggml-base-q5_1.bin');
  expect(() => getModel('../invalid')).toThrow('Unknown');
});

test('serial queue does not run operations concurrently and recovers after failure', async () => {
  const serial = createSerialQueue();
  const events: number[] = [];
  const first = serial(async () => { events.push(1); await Promise.resolve(); events.push(2); throw new Error('fail'); });
  const second = serial(async () => { events.push(3); return 4; });
  await expect(first).rejects.toThrow('fail');
  await expect(second).resolves.toBe(4);
  expect(events).toEqual([1, 2, 3]);
});

test('progress aggregates files without double-counting repeated updates or aggregate events', () => {
  const callback = jest.fn();
  const report = createProgressReporter('base-q5_1', callback);
  report({ status: 'progress', name: 'repo', file: 'a', loaded: 10, total: 100, progress: 10 });
  report({ status: 'progress', name: 'repo', file: 'b', loaded: 20, total: 200, progress: 10 });
  report({ status: 'progress', name: 'repo', file: 'a', loaded: 50, total: 100, progress: 50 });
  expect(callback).toHaveBeenLastCalledWith({ modelId: 'base-q5_1', receivedBytes: 70, totalBytes: 300 });
  report({ status: 'progress_total', name: 'repo', loaded: 70, total: 300, progress: 23, files: {} });
  expect(callback).toHaveBeenLastCalledWith({ modelId: 'base-q5_1', receivedBytes: 70, totalBytes: 300 });
});

import { resample, webAudioWindows } from '../audio';
import { downmixRange, overlapTail, pcmWindows, toPcm16 } from '../audio';
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


test('PCM16 is clipped, signed little endian, with silence for NaN', () => {
  const data = toPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2, NaN]));
  expect(Array.from(new Uint8Array(data))).toEqual([
    0, 128, 0, 128, 0, 192, 0, 0, 0, 64, 255, 127, 255, 127, 0, 0,
  ]);
});

function decoded(channels: Float32Array[]) {
  return { length: channels[0].length, numberOfChannels: channels.length,
    copyFromChannel: (out: Float32Array, channel: number, start = 0) => {
      out.set(channels[channel].subarray(start, start + out.length));
    } };
}

test('range downmix and overlap tail copy only requested frames', () => {
  const source = decoded([new Float32Array([1, 0, -1]), new Float32Array([0, 1, 1])]);
  expect(Array.from(downmixRange(source, 1, 3))).toEqual([0.5, 0]);
  expect(() => downmixRange(source, -1, 3)).toThrow('range');
  const audio = new Float32Array(32_000);
  audio.fill(0.5, 16_000);
  expect(overlapTail(decoded([audio]))).toEqual(new Float32Array(16_000).fill(0.5));
});

test('window offsets account for overlap, cap size at ten minutes, and preserve the final sample', () => {
  const source = { length: 9_600_001, numberOfChannels: 1,
    copyFromChannel: (out: Float32Array, _channel: number, start = 0) => {
      out.fill(0.5);
      if (start + out.length === 9_600_001) out[out.length - 1] = -1;
    } };
  const windows = pcmWindows(source, new Float32Array(16_000).fill(-0.5));
  expect(windows.map(({ data, startMs }) => [data.byteLength, startMs]))
    .toEqual([[19_200_000, -1000], [32_002, 599000]]);
  expect(new DataView(windows[0].data).getInt16(0, true)).toBe(-16384);
  expect(new DataView(windows[0].data).getInt16(32_000, true)).toBe(16384);
  expect(new DataView(windows[1].data).getInt16(32_000, true)).toBe(-32768);
  expect(pcmWindows(decoded([new Float32Array(0)]))).toEqual([]);
});


test.each([44100, 48000])('resamples actual %s Hz decoder output to 16 kHz', (rate) => {
  const audio = Float32Array.from({ length: rate }, (_, i) => i / rate);
  const result = resample(audio, rate);
  expect(result).toHaveLength(16000);
  expect(result[8000]).toBeCloseTo(0.5, 5);
  expect(result[15999]).toBeCloseTo(15999 / 16000, 5);
  expect(audio).toHaveLength(rate);
});

test('resampler handles empty, single sample, upsampling and invalid rates', () => {
  expect(resample(new Float32Array(), 48000)).toHaveLength(0);
  expect(Array.from(resample(new Float32Array([0, 1]), 8000))).toEqual([0, 0.5, 1, 1]);
  expect(Array.from(resample(new Float32Array([0.5]), 16000, 32000))).toEqual([0.5, 0.5]);
  expect(() => resample(new Float32Array(1), 0)).toThrow('sample rate');
});

test('web windows cap transfers, overlap one second and retain the final sample', () => {
  const source = new Float32Array(9600001);
  source[source.length - 1] = 0.75;
  const windows = [...webAudioWindows(source, new Float32Array(16000))];
  expect(windows.map(({ audio, startMs }) => [audio.length, startMs]))
    .toEqual([[9600000, -1000], [32001, 598000]]);
  expect(windows[1].audio.at(-1)).toBe(0.75);
  expect(windows[0].audio.buffer).not.toBe(source.buffer);
  expect(windows[1].audio.buffer).not.toBe(source.buffer);
});

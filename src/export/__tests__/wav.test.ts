import { muxWav, pcm16, wavHeader } from '../wav';
import { audioExtension, safeTitle } from '../common';
test('PCM clips and encodes signed little-endian 16 bit', () => {
  const pcm = pcm16(Float32Array.of(-2, -1, -0.5, 0, 0.5, 1, 2, NaN)); const v = new DataView(pcm.buffer);
  expect(Array.from({ length: 8 }, (_, i) => v.getInt16(i * 2, true))).toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
});
test('WAV header describes all parts and keeps them separate', () => {
  const parts = [pcm16(Float32Array.of(0, 1)), pcm16(Float32Array.of(-1))]; const output = muxWav(parts, 48000); const v = new DataView(output[0].buffer);
  expect(String.fromCharCode(...output[0].slice(0, 4))).toBe('RIFF');
  expect(v.getUint32(4, true)).toBe(42); expect(v.getUint32(40, true)).toBe(6);
  expect(v.getUint32(24, true)).toBe(48000); expect(v.getUint32(28, true)).toBe(96000);
  expect(v.getUint16(22, true)).toBe(1); expect(v.getUint16(34, true)).toBe(16); expect(output[1]).toBe(parts[0]);
  expect(() => wavHeader(2 ** 32, 48000)).toThrow(); expect(() => muxWav([Uint8Array.of(0)], 48000)).toThrow();
});
test('safe titles and original extensions', () => {
  expect(safeTitle('../a/b:*?')).toBe('_a_b___'); expect(safeTitle('...')).toBe('recording');
  expect(audioExtension('audio/webm;codecs=opus')).toBe('webm'); expect(audioExtension('audio/mpeg')).toBe('mp3');
});

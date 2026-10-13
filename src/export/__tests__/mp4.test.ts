import { buildMp4aSampleEntry, concatM4a, muxAac, parseM4a } from '../mp4';
const join = (parts: Uint8Array[]) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { b.set(p, at); at += p.length; } return b; };
const entry = buildMp4aSampleEntry(Uint8Array.of(0x11, 0x88), 48000);
const samples = [1, 2, 3, 4].map((n, i) => ({ data: new Uint8Array(n).fill(10 + i), duration: i === 3 ? 512 : 1024 }));
const file = () => join(muxAac({ sampleEntry: entry, timescale: 48000, samples }));
function locate(b: Uint8Array, type: string) { for (let i = 4; i < b.length - 4; i++) if (String.fromCharCode(...b.subarray(i, i + 4)) === type) return i - 4; throw new Error(type); }
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
test('round trips raw entry, sizes, durations, offsets and fast-start layout', () => {
  const bytes = file(), parsed = parseM4a(bytes);
  expect(parsed.timescale).toBe(48000); expect(parsed.sampleEntry).toEqual(entry);
  expect(locate(bytes, 'moov')).toBeLessThan(locate(bytes, 'mdat'));
  expect(parsed.samples.map(s => s.size)).toEqual([1, 2, 3, 4]);
  expect(parsed.samples.map(s => s.duration)).toEqual([1024, 1024, 1024, 512]);
  let offset = locate(bytes, 'mdat') + 8;
  parsed.samples.forEach((s, i) => { expect(s.offset).toBe(offset); expect(bytes.slice(s.offset, s.offset + s.size)).toEqual(samples[i].data); offset += s.size; });
});
test('three-file concat retains sample order and duration', () => {
  const files = [10, 20, 30].map(n => join(muxAac({ sampleEntry: entry, timescale: 48000, samples: [{ data: Uint8Array.of(n), duration: n * 100 }] })));
  const result = join(concatM4a(files)), parsed = parseM4a(result);
  expect(parsed.samples.map(s => result[s.offset])).toEqual([10, 20, 30]);
  expect(parsed.samples.reduce((n, s) => n + s.duration, 0)).toBe(6000);
});
test('stts run length compression writes two runs', () => {
  const bytes = file(), at = locate(bytes, 'stts'), v = view(bytes);
  expect(v.getUint32(at + 12)).toBe(2);
  expect([16, 20, 24, 28].map(n => v.getUint32(at + n))).toEqual([3, 1024, 1, 512]);
});
test('rejects different codec entries and timescales', () => {
  const changed = entry.slice(); changed[changed.length - 1] ^= 1;
  const other = (sampleEntry: Uint8Array, timescale = 48000) => join(muxAac({ sampleEntry, timescale, samples }));
  expect(() => concatM4a([file(), other(changed)])).toThrow(/incompatible.*sampleEntry/);
  expect(() => concatM4a([file(), other(entry, 44100)])).toThrow(/incompatible/);
});
test('builder writes mp4a fields and ASC inside nested ES descriptors', () => {
  const v = view(entry); expect(v.getUint32(0)).toBe(entry.length);
  expect(v.getUint16(14)).toBe(1); expect(v.getUint16(24)).toBe(1); expect(v.getUint16(26)).toBe(16); expect(v.getUint32(32)).toBe(48000 * 65536);
  const es = locate(entry, 'esds'); const payload = entry.slice(es + 12);
  expect(payload.slice(0, 5)).toEqual(Uint8Array.of(3, payload.length - 2, 0, 1, 0));
  expect(Array.from(payload)).toEqual(expect.arrayContaining([0x40, 0x15]));
  expect(payload.slice(-7)).toEqual(Uint8Array.of(5, 2, 0x11, 0x88, 6, 1, 2));
  const long = buildMp4aSampleEntry(new Uint8Array(140), 44100, 2);
  expect(long[locate(long, 'esds') + 13] & 128).toBe(128);
  expect(() => buildMp4aSampleEntry(new Uint8Array(), 48000)).toThrow();
});
// Independent sample-table fixture exercises stco, multiple stsc runs, fixed stsz,
// mdhd v1, non-audio track skipping, and 64-bit box headers.
function fixture() {
  const u = (...n: number[]) => { const b = new Uint8Array(n.length * 4); n.forEach((x, i) => view(b).setUint32(i * 4, x)); return b; };
  const text = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
  const box = (s: string, ...p: Uint8Array[]) => { const data = join(p); return join([u(data.length + 8), text(s), data]); };
  const mdat = join([u(1), text('mdat'), u(0, 22), Uint8Array.of(7, 8, 9, 10, 11, 12)]);
  const stbl = box('stbl', box('stsd', u(0, 1), entry), box('stts', u(0, 1, 3, 1024)), box('stsz', u(0, 2, 3)), box('stsc', u(0, 2, 1, 2, 1, 2, 1, 1)), box('stco', u(0, 2, 16, 20)));
  const track = (handler: string) => box('trak', box('mdia', box('mdhd', u(0x01000000, 0, 0, 0, 0, 48000, 0, 3072)), box('hdlr', u(0, 0), text(handler)), box('minf', stbl)));
  return join([mdat, box('moov', track('vide'), track('soun'))]);
}
test('reads independent stco/stsc fixed-size fixture with largesize and mdhd v1', () => {
  const p = parseM4a(fixture()); expect(p.timescale).toBe(48000);
  expect(p.samples).toEqual([16, 18, 20].map(offset => ({ offset, size: 2, duration: 1024 })));
});
test('rejects malformed boxes, offsets, counts and fragmented files', () => {
  expect(() => parseM4a(Uint8Array.of(0))).toThrow(/truncated/);
  for (const [type, offset, value] of [['co64', 20, 0xffffffff], ['stts', 16, 100], ['stsc', 24, 2], ['stsz', 16, 0xffffffff]] as const) {
    const bytes = file(); view(bytes).setUint32(locate(bytes, type) + offset, value); expect(() => parseM4a(bytes)).toThrow(/M4A/);
  }
  const bytes = file(); view(bytes).setUint32(0, 0xffffffff); expect(() => parseM4a(bytes)).toThrow(/size/);
  expect(() => concatM4a([])).toThrow(/no recordings/);
  expect(() => muxAac({ sampleEntry: entry, timescale: 0, samples })).toThrow();
  expect(() => muxAac({ sampleEntry: entry, timescale: 48000, samples: [{ data: Uint8Array.of(1), duration: 2 ** 32 }] })).toThrow(/limit/);
});

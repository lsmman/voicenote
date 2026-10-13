/**
 * Non-fragmented, unencrypted AAC MP4 sample-table reader and fast-start muxer.
 * Remuxes all encoded frames, including encoder priming/padding. Source edit lists,
 * timeline gaps/overlaps and metadata are not reproduced. Media must fit under 4GB;
 * the total duration must fit a version-0 mdhd (2^32-1 timescale ticks).
 */
export interface AacSample { data: Uint8Array; duration: number }
interface Box { type: string; start: number; body: number; end: number }
const fail = (message: string): never => { throw new Error(`M4A: ${message}`); };
const ascii = (s: string) => Uint8Array.from(s, c => c.charCodeAt(0));
function join(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
function u32(...values: number[]) {
  const out = new Uint8Array(values.length * 4); const v = new DataView(out.buffer);
  values.forEach((n, i) => { if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) fail('32-bit value overflow'); v.setUint32(i * 4, n); }); return out;
}
const box = (type: string, ...parts: Uint8Array[]) => join([u32(8 + parts.reduce((n, p) => n + p.length, 0)), ascii(type), ...parts]);
const full = (type: string, ...parts: Uint8Array[]) => box(type, u32(0), ...parts);
const textAt = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
function boxes(b: Uint8Array, start = 0, end = b.length): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength); const out: Box[] = [];
  while (start < end) {
    if (end - start < 8) fail('truncated box header');
    let size = v.getUint32(start); let header = 8;
    if (size === 1) { if (end - start < 16) fail('truncated largesize'); size = v.getUint32(start + 8) * 2 ** 32 + v.getUint32(start + 12); header = 16; }
    else if (!size) size = end - start;
    if (!Number.isSafeInteger(size) || size < header || size > end - start) fail('invalid box size');
    out.push({ type: textAt(b, start + 4), start, body: start + header, end: start + size }); start += size;
  } return out;
}
export function parseM4a(bytes: Uint8Array): { sampleEntry: Uint8Array; timescale: number; samples: { offset: number; size: number; duration: number }[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const children = (b: Box) => boxes(bytes, b.body, b.end);
  const required = (list: Box[], type: string) => list.find(b => b.type === type) ?? fail(`missing ${type} (fragmented MP4 is unsupported)`);
  const read = (b: Box, offset: number) => { if (b.body + offset + 4 > b.end) fail(`truncated ${b.type}`); return v.getUint32(b.body + offset); };
  const root = boxes(bytes); if (root.some(b => b.type === 'moof')) fail('fragmented MP4 is unsupported');
  const moov = required(root, 'moov');
  const track = children(moov).filter(b => b.type === 'trak').find(t => {
    const mdia = children(t).find(b => b.type === 'mdia'); if (!mdia) return false;
    const h = children(mdia).find(b => b.type === 'hdlr'); return h && read(h, 8) === 0x736f756e;
  }) ?? fail('no audio track');
  const mdia = children(required(children(track), 'mdia')); const mdhd = required(mdia, 'mdhd');
  const version = read(mdhd, 0) >>> 24; if (version > 1) fail('unsupported mdhd version');
  const timescale = read(mdhd, version === 1 ? 20 : 12); if (!timescale) fail('zero timescale');
  const tables = children(required(children(required(mdia, 'minf')), 'stbl'));
  const sd = required(tables, 'stsd'); if (read(sd, 4) !== 1) fail('multiple sample descriptions unsupported');
  const entry = boxes(bytes, sd.body + 8, sd.end); if (entry.length !== 1 || entry[0].type !== 'mp4a') fail('audio is not unencrypted AAC mp4a');
  const sz = required(tables, 'stsz'); const fixed = read(sz, 4); const count = read(sz, 8);
  if (!count || count > bytes.length) fail('invalid sample count');
  const sizes = Array.from({ length: count }, (_, i) => fixed || read(sz, 12 + i * 4));
  const ts = required(tables, 'stts'); const durations: number[] = [];
  for (let i = 0, n = read(ts, 4); i < n; i++) {
    const repeats = read(ts, 8 + i * 8), duration = read(ts, 12 + i * 8);
    if (!repeats || !duration || repeats > count - durations.length) fail('invalid stts');
    for (let j = 0; j < repeats; j++) durations.push(duration);
  }
  if (durations.length !== count) fail('sample duration count mismatch');
  const sc = required(tables, 'stsc'); const mappings: { first: number; count: number }[] = [];
  for (let i = 0, n = read(sc, 4); i < n; i++) {
    const first = read(sc, 8 + i * 12), per = read(sc, 12 + i * 12), description = read(sc, 16 + i * 12);
    if (!per || description !== 1 || (i === 0 ? first !== 1 : first <= mappings[i - 1].first)) fail('invalid stsc');
    mappings.push({ first, count: per });
  }
  if (!mappings.length) fail('empty stsc');
  const co = tables.find(b => b.type === 'co64') ?? required(tables, 'stco'); const wide = co.type === 'co64';
  const samples: { offset: number; size: number; duration: number }[] = []; let mapping = 0;
  const media = root.filter(b => b.type === 'mdat'); const chunks = read(co, 4);
  if (mappings[mappings.length - 1].first > chunks) fail('stsc references missing chunk');
  for (let i = 0; i < chunks; i++) {
    while (mapping + 1 < mappings.length && mappings[mapping + 1].first <= i + 1) mapping++;
    const at = 8 + i * (wide ? 8 : 4);
    let offset = wide ? read(co, at) * 2 ** 32 + read(co, at + 4) : read(co, at);
    for (let j = 0; j < mappings[mapping].count; j++) {
      const index = samples.length, size = sizes[index];
      if (index >= count || !size || !Number.isSafeInteger(offset) || !media.some(b => offset >= b.body && offset + size <= b.end)) fail('sample outside mdat');
      samples.push({ offset, size, duration: durations[index] }); offset += size;
    }
  }
  if (samples.length !== count) fail('sample offset count mismatch');
  return { sampleEntry: bytes.slice(entry[0].start, entry[0].end), timescale, samples };
}
const matrix = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
export function muxAac({ sampleEntry, timescale, samples }: { sampleEntry: Uint8Array; timescale: number; samples: AacSample[] }): Uint8Array[] {
  if (!samples.length || !Number.isInteger(timescale) || timescale <= 0) fail('empty samples or invalid timescale');
  const entries = boxes(sampleEntry); if (entries.length !== 1 || entries[0].type !== 'mp4a') fail('invalid mp4a sample entry');
  const runs: number[] = []; let duration = 0, mediaSize = 8;
  for (const s of samples) {
    if (!Number.isInteger(s.duration) || s.duration <= 0 || !s.data.length) fail('invalid AAC sample');
    duration += s.duration; mediaSize += s.data.length;
    if (runs.length && runs[runs.length - 1] === s.duration) runs[runs.length - 2]++;
    else runs.push(1, s.duration);
  }
  if (duration > 0xffffffff || mediaSize > 0xffffffff) fail('recording exceeds 32-bit duration or 4GB media limit');
  const ftyp = box('ftyp', ascii('M4A '), u32(0), ascii('M4A isommp42'));
  function moov(offset: number) {
    const stbl = box('stbl', full('stsd', u32(1), sampleEntry), full('stts', u32(runs.length / 2), join(runs.map(n => u32(n)))),
      full('stsc', u32(1, 1, samples.length, 1)), full('stsz', u32(0, samples.length), join(samples.map(s => u32(s.data.length)))),
      full('co64', u32(1, Math.floor(offset / 2 ** 32), offset % 2 ** 32)));
    const mdia = box('mdia', full('mdhd', u32(0, 0, timescale, duration), u32(0x55c40000)),
      full('hdlr', u32(0), ascii('soun'), u32(0, 0, 0), ascii('SoundHandler\0')),
      box('minf', full('smhd', u32(0)), box('dinf', full('dref', u32(1), box('url ', u32(1)))), stbl));
    return box('moov', full('mvhd', u32(0, 0, timescale, duration, 0x10000, 0x01000000, 0, 0), matrix, new Uint8Array(24), u32(2)),
      box('trak', box('tkhd', u32(3, 0, 0, 1, 0, duration, 0, 0, 0, 0x01000000), matrix, u32(0, 0)), mdia));
  }
  const header = moov(0); return [ftyp, moov(ftyp.length + header.length + 8), join([u32(mediaSize), ascii('mdat')]), ...samples.map(s => s.data)];
}
export function concatM4a(files: Uint8Array[]): Uint8Array[] {
  if (!files.length) fail('no recordings');
  const parsed = files.map(parseM4a); const first = parsed[0];
  for (const p of parsed) if (p.timescale !== first.timescale || p.sampleEntry.length !== first.sampleEntry.length || p.sampleEntry.some((v, i) => v !== first.sampleEntry[i])) fail('incompatible AAC sampleEntry/timescale (channel count, sample rate, or codec configuration differs)');
  return muxAac({ ...first, samples: parsed.flatMap((p, i) => p.samples.map(s => ({ data: files[i].subarray(s.offset, s.offset + s.size), duration: s.duration }))) });
}
function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  let size = payload.length; const length = [size & 127];
  while ((size = Math.floor(size / 128))) length.unshift((size & 127) | 128);
  return join([Uint8Array.of(tag, ...length), payload]);
}
/** AudioSpecificConfig is supplied by AudioEncoder output metadata, never guessed. */
export function buildMp4aSampleEntry(asc: Uint8Array, sampleRate: number, channels = 1): Uint8Array {
  if (!asc.length || !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 65535 || !Number.isInteger(channels) || channels < 1 || channels > 65535) fail('invalid AAC configuration');
  const config = descriptor(4, join([Uint8Array.of(0x40, 0x15, 0, 0, 0), u32(64000, 64000), descriptor(5, asc)]));
  const esds = full('esds', descriptor(3, join([Uint8Array.of(0, 1, 0), config, descriptor(6, Uint8Array.of(2))])));
  return box('mp4a', new Uint8Array(6), Uint8Array.of(0, 1), new Uint8Array(8), u32(channels * 65536 + 16, 0, sampleRate * 65536), esds);
}

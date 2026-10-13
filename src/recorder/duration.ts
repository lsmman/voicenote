/** Read movie duration from the finalized MP4/M4A mvhd atom (versions 0 and 1). */
export function mp4DurationMs(buffer: ArrayBuffer): number | undefined {
  const view = new DataView(buffer);
  function scan(start: number, end: number): number | undefined {
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      const tag = String.fromCharCode(...new Uint8Array(buffer, offset + 4, 4));
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) return;
        size = Number(view.getBigUint64(offset + 8)); header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header || offset + size > end) return;
      const body = offset + header;
      if (tag === 'moov') { const value = scan(body, offset + size); if (value !== undefined) return value; }
      if (tag === 'mvhd') {
        const version = view.getUint8(body);
        if (version > 1) return;
        const scaleOffset = body + (version === 1 ? 20 : 12);
        if (scaleOffset + (version === 1 ? 12 : 8) > offset + size) return;
        const scale = view.getUint32(scaleOffset);
        const duration = version === 1 ? Number(view.getBigUint64(scaleOffset + 4)) : view.getUint32(scaleOffset + 4);
        if (scale && Number.isFinite(duration)) return duration / scale * 1000;
      }
      offset += size;
    }
  }
  return scan(0, buffer.byteLength);
}

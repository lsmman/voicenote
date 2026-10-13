/** PCM conversion happens per recording chunk; only compact PCM parts are retained. */
export function pcm16(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
  samples.forEach((value, i) => {
    const s = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    view.setInt16(i * 2, Math.round(s * (s < 0 ? 32768 : 32767)), true);
  }); return bytes;
}
export function wavHeader(frames: number, sampleRate: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(frames) || frames < 0 || frames * 2 > 0xffffffff - 36 || !Number.isInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0x7fffffff) throw new Error('WAV exceeds RIFF size limit or has invalid sample rate');
  const bytes = new Uint8Array(44); const v = new DataView(bytes.buffer);
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, frames * 2, true); return bytes;
}
export function muxWav(parts: Uint8Array[], sampleRate: number): Uint8Array[] {
  if (parts.some(p => p.length % 2)) throw new Error('Invalid PCM16 byte length');
  return [wavHeader(parts.reduce((n, p) => n + p.length / 2, 0), sampleRate), ...parts];
}

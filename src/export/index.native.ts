import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { store } from '../store';
import { resolveLocalPath } from '../recorder/paths';
import { concatM4a } from './mp4';
import { isMp4, safeTitle } from './common';

// Serialize exports so equal titles cannot overwrite a file while its share sheet is open.
let pending: Promise<void> = Promise.resolve();
/**
 * Export locally available AAC chunks to one cache M4A and open the share sheet.
 * Progress is 0..1 for input chunks read. Single non-MP4 imports share the original
 * file without conversion. Cache output remains available to receiving apps.
 */
export async function exportNoteAudio(noteId: string, title: string, onProgress?: (p: number) => void): Promise<void> {
  const task = pending.then(() => exportAudio(noteId, title, onProgress));
  pending = task.catch(() => {}); return task;
}
async function exportAudio(noteId: string, title: string, onProgress?: (p: number) => void): Promise<void> {
  const chunks = (await store.listChunks(noteId)).slice().sort((a, b) => a.seq - b.seq);
  if (!chunks.length) throw new Error('This note has no audio to export');
  if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing is unavailable on this device');
  onProgress?.(0);
  const files = chunks.map(c => {
    if (!c.localPath) throw new Error(`Audio chunk ${c.seq} is not available locally`);
    const file = new File(resolveLocalPath(c.localPath));
    if (!file.exists) throw new Error(`Audio chunk ${c.seq} is missing`);
    return file;
  });
  // Imported MP3/WAV/etc. retain their original URI, extension, and encoding.
  if (chunks.length === 1 && !isMp4(chunks[0].mimeType)) {
    onProgress?.(1); await Sharing.shareAsync(files[0].uri, { mimeType: chunks[0].mimeType }); return;
  }
  if (chunks.some(c => !isMp4(c.mimeType))) throw new Error('Cannot combine non-AAC native recordings');
  const bytes: Uint8Array[] = [];
  for (let i = 0; i < files.length; i++) { bytes.push(await files[i].bytes()); onProgress?.((i + 1) / files.length); }
  const parts = concatM4a(bytes);
  const output = new File(Paths.cache, `${safeTitle(title)}.m4a`);
  output.create({ overwrite: true });
  try {
    const handle = output.open();
    try { for (const part of parts) handle.writeBytes(part); } finally { handle.close(); }
  } catch (error) { if (output.exists) output.delete(); throw error; }
  await Sharing.shareAsync(output.uri, { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' });
}

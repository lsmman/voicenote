import type { LocalStore } from '../store/types';

export async function deleteLocalFile(_uri: string): Promise<void> {
  throw new Error('Native file deletion is unavailable on web');
}

export function readAudioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(blob);
    const cleanup = () => {
      clearTimeout(timer);
      audio.onloadedmetadata = null; audio.onerror = null;
      audio.removeAttribute('src'); audio.load(); URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Audio metadata timed out')); }, 120_000);
    audio.onloadedmetadata = () => {
      const durationMs = Math.round(audio.duration * 1000);
      cleanup();
      if (!Number.isFinite(durationMs) || durationMs <= 0) reject(new Error('오디오 길이를 읽지 못했습니다.'));
      else resolve(durationMs);
    };
    audio.onerror = () => { cleanup(); reject(new Error('오디오 길이를 읽지 못했습니다.')); };
    audio.preload = 'metadata'; audio.src = url;
  });
}

export async function prepareImportedAudio(uri: string, _name: string, noteId: string, store: LocalStore) {
  if (!store.putAudioBlob) throw new Error('Audio blob storage unavailable');
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Could not read imported audio');
  const blob = await response.blob();
  const durationMs = await readAudioDuration(blob);
  const localPath = `${noteId}/0`;
  await store.putAudioBlob(localPath, blob);
  return { localPath, durationMs };
}

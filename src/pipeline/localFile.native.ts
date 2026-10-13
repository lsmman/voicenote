import { Directory, File, Paths } from 'expo-file-system';
import { getAudioDuration } from 'react-native-audio-api';
import type { LocalStore } from '../store/types';

export async function deleteLocalFile(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function prepareImportedAudio(uri: string, name: string, noteId: string, _store: LocalStore) {
  const directory = new Directory(Paths.document, 'recordings', noteId);
  directory.create({ intermediates: true, idempotent: true });
  const extension = name.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1].toLowerCase() ?? 'audio';
  const target = new File(directory, `import.${extension}`);
  await new File(uri).copy(target);
  const seconds = await getAudioDuration(target.uri);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('오디오 길이를 읽지 못했습니다.');
  return { localPath: target.uri, durationMs: Math.round(seconds * 1000) };
}

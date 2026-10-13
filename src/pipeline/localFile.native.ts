import { File } from 'expo-file-system';

export async function deleteLocalFile(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}

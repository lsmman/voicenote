export async function deleteLocalFile(_uri: string): Promise<void> {
  throw new Error('Native file deletion is unavailable on web');
}

import { File, Paths } from 'expo-file-system';

/** Resolve Documents-relative persisted paths after an iOS sandbox relocation. */
export function resolveLocalPath(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path; // Legacy absolute URI.
  return new File(Paths.document, path).uri;
}

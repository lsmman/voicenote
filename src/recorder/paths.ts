/** IndexedDB keys need no filesystem resolution. */
export function resolveLocalPath(path: string): string { return path; }

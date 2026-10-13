import type { ModelDownloadProgress } from '../types';

export function createProgressReporter(modelId: string, report: (p: ModelDownloadProgress) => void) {
  const files = new Map<string, { loaded: number; total: number }>();
  return (event: { status: string; name?: string; file?: string; loaded?: number; total?: number; progress?: number; files?: unknown }) => {
    if (typeof event.loaded !== 'number' || typeof event.total !== 'number') return;
    if (event.status === 'progress_total') {
      report({ modelId, receivedBytes: event.loaded, totalBytes: event.total });
    } else if (event.status === 'progress') {
      files.set(`${event.name}/${event.file}`, { loaded: event.loaded, total: event.total });
      let receivedBytes = 0;
      let totalBytes = 0;
      for (const file of files.values()) {
        receivedBytes += file.loaded;
        totalBytes += file.total;
      }
      report({ modelId, receivedBytes, totalBytes });
    }
    // initiate/download/done/ready contain no byte counts. Never invent them.
  };
}

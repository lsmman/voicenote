/** @jest-environment node */
import 'fake-indexeddb/auto';
import { expect, jest, test } from '@jest/globals';

globalThis.structuredClone = (globalThis as unknown as {
  originalstructuredClone: typeof structuredClone;
}).originalstructuredClone;

test('blocking an upgrade keeps the shared connection usable for current and later operations', async () => {
  const opens = jest.spyOn(indexedDB, 'open');
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { store } = jest.requireActual<typeof import('../index')>('../index.ts');
  await store.init();
  const connection = (opens.mock.results[0].value as IDBOpenDBRequest).result;
  const upgrade = indexedDB.open('voicenote', 2);
  try {
    await new Promise<void>((resolve, reject) => {
      upgrade.onblocked = () => resolve();
      upgrade.onerror = () => reject(upgrade.error);
    });
    await store.createNote({ id: 'active', userId: null, title: 'Active', createdAt: '2026-10-13', durationMs: 0, status: 'recording', modelName: null, gaps: [] });
    expect((await store.getNote('active'))?.title).toBe('Active');
    expect(opens).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('waiting for this tab'));
  } finally {
    const finished = new Promise<void>(resolve => {
      upgrade.onupgradeneeded = () => upgrade.transaction!.abort();
      upgrade.onerror = () => resolve();
    });
    connection.close();
    await finished;
    opens.mockRestore();
    warn.mockRestore();
  }
});

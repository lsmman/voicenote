const mockStatement = { executeAsync: jest.fn(), finalizeAsync: jest.fn() };
const mockConnection = {
  execAsync: jest.fn(), getFirstAsync: jest.fn(), getAllAsync: jest.fn(),
  runAsync: jest.fn(), prepareAsync: jest.fn(), closeAsync: jest.fn(),
};
const mockDelete = jest.fn();
const mockFile = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(async () => mockConnection) }));
jest.mock('../../recorder/paths', () => ({ resolveLocalPath: (path: string) => path }));
jest.mock('expo-file-system', () => ({ File: function (path: string) { return mockFile(path); } }));
import { store } from '../index.native';
import type { AudioChunk, Memo, Segment, Summary } from '../../core/types';
const segment: Segment = { id: 's', noteId: 'n', startMs: 0, endMs: 1, text: 'hello', speakerLabel: null, edited: false };

beforeAll(async () => {
  mockConnection.getFirstAsync.mockResolvedValue({ user_version: 1 });
  await store.init();
});
beforeEach(() => {
  jest.clearAllMocks();
  mockConnection.getFirstAsync.mockResolvedValue({ id: 'n' });
  mockConnection.getAllAsync.mockResolvedValue([]);
  mockConnection.prepareAsync.mockResolvedValue(mockStatement);
  mockStatement.executeAsync.mockResolvedValue({});
  mockFile.mockImplementation(path => ({ exists: path !== 'missing', delete: mockDelete }));
});

test('segment batches prepare once, preserve noteId on conflict, and finalize before commit', async () => {
  await store.putSegments('n', [segment, { ...segment, id: 's2', speakerLabel: undefined } as unknown as Segment]);
  expect(mockConnection.prepareAsync).toHaveBeenCalledTimes(1);
  const sql = mockConnection.prepareAsync.mock.calls[0][0] as string;
  expect(sql.split('DO UPDATE SET')[1]).not.toContain('noteId');
  expect(mockStatement.executeAsync).toHaveBeenCalledTimes(2);
  expect(mockStatement.executeAsync.mock.calls[1][0][5]).toBeNull();
  expect(mockStatement.finalizeAsync).toHaveBeenCalledTimes(1);
  expect(mockConnection.execAsync.mock.calls).toEqual([['BEGIN IMMEDIATE'], ['COMMIT']]);
  expect(mockStatement.finalizeAsync.mock.invocationCallOrder[0]).toBeLessThan(mockConnection.execAsync.mock.invocationCallOrder[1]);
});

test('failed segment writes finalize and rollback; the serialized queue remains usable', async () => {
  mockStatement.executeAsync.mockRejectedValueOnce(new Error('write failed'));
  await expect(store.putSegments('n', [segment])).rejects.toThrow('write failed');
  expect(mockStatement.finalizeAsync).toHaveBeenCalledTimes(1);
  expect(mockConnection.execAsync.mock.calls).toEqual([['BEGIN IMMEDIATE'], ['ROLLBACK']]);
  await store.putSegments('n', [segment]);
  expect(mockConnection.execAsync).toHaveBeenLastCalledWith('COMMIT');
});

test('late child writes skip deleted parents', async () => {
  mockConnection.getFirstAsync.mockResolvedValue(null);
  await store.addChunk({ noteId: 'gone' } as AudioChunk);
  await store.putSegments('gone', [{ ...segment, noteId: 'gone' }]);
  await store.replaceSegments('gone', []);
  await store.addMemo({ noteId: 'gone' } as Memo);
  await store.putSummary({ noteId: 'gone' } as Summary);
  expect(mockConnection.runAsync).not.toHaveBeenCalled();
  expect(mockConnection.prepareAsync).not.toHaveBeenCalled();
});

test('file cleanup runs after commit and ignores missing files', async () => {
  mockConnection.getAllAsync.mockResolvedValue([{ localPath: 'present' }, { localPath: 'missing' }, { localPath: null }]);
  await store.deleteNote('n');
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockConnection.execAsync).toHaveBeenLastCalledWith('COMMIT');
  expect(mockConnection.execAsync.mock.invocationCallOrder[1]).toBeLessThan(mockFile.mock.invocationCallOrder[0]);
});

test('rolled-back deletion leaves audio files untouched', async () => {
  mockConnection.getAllAsync.mockResolvedValue([{ localPath: 'present' }]);
  mockConnection.runAsync.mockRejectedValueOnce(new Error('delete failed'));
  await expect(store.deleteNote('n')).rejects.toThrow('delete failed');
  expect(mockFile).not.toHaveBeenCalled();
  expect(mockConnection.execAsync).toHaveBeenLastCalledWith('ROLLBACK');
});

test('search filters titles and distinct segment noteIds in SQL with literal parameters', async () => {
  await store.listNotes('50%_DONE');
  expect(mockConnection.getAllAsync).toHaveBeenCalledWith(
    expect.stringContaining('SELECT DISTINCT noteId FROM segments WHERE instr(lower(text), ?) > 0'), '50%_done', '50%_done',
  );
  expect(mockConnection.getAllAsync.mock.calls[0][0]).toContain('instr(lower(title), ?) > 0');
});

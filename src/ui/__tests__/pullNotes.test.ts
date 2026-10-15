jest.mock('../../services', () => ({
  store: { getNote: jest.fn(), createNote: jest.fn(), addChunk: jest.fn(), listSegments: jest.fn(), listMemos: jest.fn(), getSummary: jest.fn(), putSegments: jest.fn(), addMemo: jest.fn(), putSummary: jest.fn() },
  sync: { pullNotes: jest.fn(), pullNoteDetail: jest.fn(), pullChunks: jest.fn() },
}));
import { store, sync } from '../../services';
import { pullMissingNotes, pullMissingDetail } from '../pullNotes';
const mocks = { store: store as jest.Mocked<typeof store>, sync: sync as jest.Mocked<typeof sync> };
beforeEach(() => {
  jest.resetAllMocks();
  mocks.store.listSegments.mockResolvedValue([]);
  mocks.store.listMemos.mockResolvedValue([]);
  mocks.store.getSummary.mockResolvedValue(null);
});
const detail = {
  segments: [{ id: 's', noteId: 'new', startMs: 0, endMs: 1000, text: 'transcript', speakerLabel: null, edited: false }],
  memos: [{ id: 'm', noteId: 'new', atMs: 0, text: 'memo', kind: 'memo' as const }],
  summary: { noteId: 'new', summary: [{ text: 'summary', atMs: 0 }], keywords: [], todos: [], createdAt: '2026-10-15' },
};
test('pull creates missing notes without overwriting local titles', async () => {
  mocks.sync.pullNotes.mockResolvedValue([{ id: 'existing', title: 'remote' }, { id: 'new', title: 'new' }] as never);
  mocks.store.getNote.mockImplementation(async id => id === 'existing' ? { id, title: 'local edit' } as never : null);
  mocks.sync.pullChunks.mockResolvedValue([{ noteId: 'new', seq: 0, remotePath: 'u/new/0.webm' }] as never);
  mocks.store.listSegments.mockResolvedValue([{ id: 'existing-segment' }] as never);
  mocks.sync.pullNoteDetail.mockResolvedValue(detail);
  mocks.store.createNote.mockImplementation(async () => {
    expect(mocks.store.putSegments).toHaveBeenCalledWith('new', detail.segments);
    expect(mocks.store.addMemo).toHaveBeenCalledWith(detail.memos[0]);
    expect(mocks.store.putSummary).toHaveBeenCalledWith(detail.summary);
    expect(mocks.store.addChunk).toHaveBeenCalledWith({ noteId: 'new', seq: 0, remotePath: 'u/new/0.webm' });
  });
  await pullMissingNotes();
  expect(mocks.sync.pullNoteDetail).toHaveBeenCalledTimes(1);
  expect(mocks.sync.pullNoteDetail).toHaveBeenCalledWith('new');
  expect(mocks.sync.pullChunks).toHaveBeenCalledWith('new');
  expect(mocks.store.addChunk).toHaveBeenCalledWith({ noteId: 'new', seq: 0, remotePath: 'u/new/0.webm' });
  expect(mocks.store.createNote).toHaveBeenCalledTimes(1);
  expect(mocks.store.createNote).toHaveBeenCalledWith({ id: 'new', title: 'new' });
});
test('detail pull fills missing content while preserving locally edited segments and summaries', async () => {
  mocks.sync.pullNoteDetail.mockResolvedValue({ segments: [{ id: 's', text: 'remote' }, { id: 'new', text: 'new' }], memos: [{ id: 'm' }, { id: 'newMemo' }], summary: { noteId: 'n' } } as never);
  mocks.store.listSegments.mockResolvedValue([{ id: 's', edited: true, text: 'local' }] as never);
  mocks.store.listMemos.mockResolvedValue([{ id: 'm' }] as never);
  mocks.store.getSummary.mockResolvedValue({ noteId: 'n', summary: [{ text: 'local summary', atMs: 0 }] } as never);
  await pullMissingDetail('n');
  expect(mocks.store.putSegments).toHaveBeenCalledWith('n', [{ id: 'new', text: 'new' }]);
  expect(mocks.store.addMemo).toHaveBeenCalledTimes(1);
  expect(mocks.store.addMemo).toHaveBeenCalledWith({ id: 'newMemo' });
  expect(mocks.store.putSummary).not.toHaveBeenCalled();
});

test('pull repairs existing notes with no segments without recreating them', async () => {
  mocks.sync.pullNotes.mockResolvedValue([{ id: 'new', title: 'remote' }] as never);
  mocks.store.getNote.mockResolvedValue({ id: 'new', title: 'local' } as never);
  mocks.sync.pullNoteDetail.mockResolvedValue(detail);
  await pullMissingNotes();
  expect(mocks.store.putSegments).toHaveBeenCalledWith('new', detail.segments);
  expect(mocks.store.addMemo).toHaveBeenCalledWith(detail.memos[0]);
  expect(mocks.store.putSummary).toHaveBeenCalledWith(detail.summary);
  expect(mocks.store.createNote).not.toHaveBeenCalled();
});
test('detail pull replaces an empty local summary', async () => {
  mocks.sync.pullNoteDetail.mockResolvedValue(detail);
  mocks.store.getSummary.mockResolvedValue({ ...detail.summary, summary: [] });
  await pullMissingDetail('new');
  expect(mocks.store.putSummary).toHaveBeenCalledWith(detail.summary);
});
test('failed detail persistence leaves a new note hidden', async () => {
  mocks.sync.pullNotes.mockResolvedValue([{ id: 'new' }] as never);
  mocks.store.getNote.mockResolvedValue(null);
  mocks.sync.pullNoteDetail.mockResolvedValue(detail);
  mocks.sync.pullChunks.mockResolvedValue([]);
  mocks.store.putSummary.mockRejectedValue(new Error('write failed'));
  await expect(pullMissingNotes()).rejects.toThrow('write failed');
  expect(mocks.store.createNote).not.toHaveBeenCalled();
});

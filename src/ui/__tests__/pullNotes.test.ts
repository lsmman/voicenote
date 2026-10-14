jest.mock('../../services', () => ({
  store: { getNote: jest.fn(), createNote: jest.fn(), addChunk: jest.fn(), listSegments: jest.fn(), listMemos: jest.fn(), getSummary: jest.fn(), putSegments: jest.fn(), addMemo: jest.fn(), putSummary: jest.fn() },
  sync: { pullNotes: jest.fn(), pullNoteDetail: jest.fn(), pullChunks: jest.fn() },
}));
import { store, sync } from '../../services';
import { pullMissingNotes, pullMissingDetail } from '../pullNotes';
const mocks = { store: store as jest.Mocked<typeof store>, sync: sync as jest.Mocked<typeof sync> };
beforeEach(() => jest.resetAllMocks());
test('pull creates missing notes without overwriting local titles', async () => {
  mocks.sync.pullNotes.mockResolvedValue([{ id: 'existing', title: 'remote' }, { id: 'new', title: 'new' }] as never);
  mocks.store.getNote.mockImplementation(async id => id === 'existing' ? { id, title: 'local edit' } as never : null);
  mocks.sync.pullChunks.mockResolvedValue([{ noteId: 'new', seq: 0, remotePath: 'u/new/0.webm' }] as never);
  await pullMissingNotes();
  expect(mocks.sync.pullChunks).toHaveBeenCalledWith('new');
  expect(mocks.store.addChunk).toHaveBeenCalledWith({ noteId: 'new', seq: 0, remotePath: 'u/new/0.webm' });
  expect(mocks.store.createNote).toHaveBeenCalledTimes(1);
  expect(mocks.store.createNote).toHaveBeenCalledWith({ id: 'new', title: 'new' });
});
test('detail pull fills missing content while preserving locally edited segments and summaries', async () => {
  mocks.sync.pullNoteDetail.mockResolvedValue({ segments: [{ id: 's', text: 'remote' }, { id: 'new', text: 'new' }], memos: [{ id: 'm' }, { id: 'newMemo' }], summary: { noteId: 'n' } } as never);
  mocks.store.listSegments.mockResolvedValue([{ id: 's', edited: true, text: 'local' }] as never);
  mocks.store.listMemos.mockResolvedValue([{ id: 'm' }] as never);
  mocks.store.getSummary.mockResolvedValue({ noteId: 'n' } as never);
  await pullMissingDetail('n');
  expect(mocks.store.putSegments).toHaveBeenCalledWith('n', [{ id: 'new', text: 'new' }]);
  expect(mocks.store.addMemo).toHaveBeenCalledTimes(1);
  expect(mocks.store.addMemo).toHaveBeenCalledWith({ id: 'newMemo' });
  expect(mocks.store.putSummary).not.toHaveBeenCalled();
});

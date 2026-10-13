/// <reference types="jest" />
import type { AudioChunk, Memo, Note, Segment, Summary } from '../../core/types';
import type { LocalStore } from '../../store/types';
import type { RecorderEvents, RecorderState } from '../../recorder/types';
import type { PipelineDeps } from '../createPipeline';

export const note = (id = 'note', status: Note['status'] = 'recording'): Note => ({
  id, status, title: id, userId: null, createdAt: '2026-10-13T00:00:00.000Z', durationMs: 0, modelName: null, gaps: [],
});
export const chunk = (noteId = 'note', seq = 0): AudioChunk => ({
  noteId, seq, startMs: seq * 30_000, durationMs: 30_000, localPath: `${noteId}/${seq}`, mimeType: 'audio/webm', remotePath: null, uploadedAt: null, transcribedAt: null,
});
export function fakes() {
  const notes = new Map<string, Note>();
  const chunks = new Map<string, AudioChunk>();
  const segments = new Map<string, Segment>();
  const memos = new Map<string, Memo>();
  const summaries = new Map<string, Summary>();
  const history: Note['status'][] = [];
  const blobs = new Map<string, Blob>();
  const store: LocalStore = {
    init: async () => {},
    createNote: async n => { notes.set(n.id, { ...n }); history.push(n.status); },
    updateNote: async (id, patch) => { notes.set(id, { ...notes.get(id)!, ...patch }); if (patch.status) history.push(patch.status); },
    getNote: async id => notes.get(id) ?? null,
    listNotes: async () => [...notes.values()],
    deleteNote: async id => { notes.delete(id); },
    addChunk: jest.fn(async c => { chunks.set(`${c.noteId}/${c.seq}`, { ...c }); }),
    updateChunk: async (id, seq, patch) => { const key = `${id}/${seq}`; chunks.set(key, { ...chunks.get(key)!, ...patch }); },
    listChunks: async id => [...chunks.values()].filter(c => c.noteId === id).sort((a, b) => a.seq - b.seq),
    putSegments: async (_id, items) => { items.forEach(s => segments.set(s.id, { ...s })); },
    replaceSegments: async (id, items) => { for (const [key, s] of segments) if (s.noteId === id) segments.delete(key); items.forEach(s => segments.set(s.id, { ...s })); },
    updateSegment: async (id, patch) => { segments.set(id, { ...segments.get(id)!, ...patch }); },
    listSegments: async id => [...segments.values()].filter(s => s.noteId === id).sort((a, b) => a.startMs - b.startMs),
    addMemo: async memo => { memos.set(memo.id, memo); },
    deleteMemo: async id => { memos.delete(id); },
    listMemos: async id => [...memos.values()].filter(m => m.noteId === id),
    putSummary: async s => { summaries.set(s.noteId, s); },
    getSummary: async id => summaries.get(id) ?? null,
    putAudioBlob: async (key, blob) => { blobs.set(key, blob); },
    getAudioBlob: async key => blobs.get(key) ?? null,
    deleteAudioBlob: jest.fn(async key => { blobs.delete(key); }),
  };
  let events: Partial<RecorderEvents> = {};
  let state: RecorderState = 'idle';
  const deps: PipelineDeps = {
    platform: 'native', getNetworkType: jest.fn(async () => 'wifi'),
    store, now: Date.now, getModelId: async () => 'test-model',
    isOnline: jest.fn(async () => true), isSignedIn: jest.fn(async () => true),
    recorder: {
      start: jest.fn(async (_id, e) => { events = e; state = 'recording'; e.onStateChange?.(state); }),
      pause: async () => { state = 'paused'; events.onStateChange?.(state); },
      resume: async () => { state = 'recording'; events.onStateChange?.(state); },
      stop: jest.fn(async () => { state = 'idle'; events.onStateChange?.(state); }),
      getState: () => state,
    },
    engine: {
      listModels: () => [], isModelReady: jest.fn(async () => true), downloadModel: async () => {}, deleteModel: async () => {},
      load: jest.fn(async () => {}), transcribeChunk: jest.fn(async c => [{ startMs: 0, endMs: c.durationMs || 900, text: `chunk ${c.seq}` }]),
    },
    sync: {
      uploadChunk: jest.fn(async c => `remote/${c.noteId}/${c.seq}`), pushNote: async () => {}, pullNotes: async () => [],
      pullNoteDetail: async () => ({ segments: [], memos: [], summary: null }), chunkUrl: async p => p,
      summarize: jest.fn(async () => ({ summary: [{ text: 'summary', atMs: 0 }], keywords: [], todos: [] })),
    },
  };
  return { deps, notes, chunks, summaries, blobs, history, events: () => events };
}

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AudioChunk, Memo, Note, Segment, Summary } from '../core/types';
import type { LocalStore } from './types';

interface Schema extends DBSchema {
  notes: { key: string; value: Note };
  chunks: { key: [string, number]; value: AudioChunk; indexes: { noteId: string } };
  segments: { key: string; value: Segment; indexes: { noteId: string } };
  memos: { key: string; value: Memo; indexes: { noteId: string } };
  summaries: { key: string; value: Summary };
  audio: { key: string; value: Blob };
}

let database: Promise<IDBPDatabase<Schema>> | undefined;
function db() {
  database ??= openDB<Schema>('voicenote', 1, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('notes', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['noteId', 'seq'] }).createIndex('noteId', 'noteId');
        db.createObjectStore('segments', { keyPath: 'id' }).createIndex('noteId', 'noteId');
        db.createObjectStore('memos', { keyPath: 'id' }).createIndex('noteId', 'noteId');
        db.createObjectStore('summaries', { keyPath: 'noteId' });
        db.createObjectStore('audio');
      }
    },
    blocked() { console.warn('Local store upgrade is blocked; close other tabs to continue.'); },
    // Keep the shared connection usable until this tab closes, including in-flight operations.
    blocking() { console.warn('Local store upgrade is waiting for this tab to close.'); },
    terminated() { database = undefined; },
  }).catch(error => { database = undefined; throw error; });
  return database;
}

async function update<T extends 'notes' | 'chunks' | 'segments'>(
  name: T, key: Schema[T]['key'], patch: Partial<Schema[T]['value']>,
) {
  const tx = (await db()).transaction(name, 'readwrite');
  const current = await tx.store.get(key);
  if (current) {
    // Identity fields cannot be changed by a partial update.
    const identity = name === 'chunks'
      ? { noteId: (current as AudioChunk).noteId, seq: (current as AudioChunk).seq }
      : { id: (current as Note | Segment).id, ...(name === 'segments' ? { noteId: (current as Segment).noteId } : {}) };
    await tx.store.put({ ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), ...identity });
  }
  await tx.done;
}

async function writeSegments(noteId: string, segments: Segment[], replace: boolean) {
  const connection = await db();
  if (segments.some(segment => segment.noteId !== noteId)) throw new Error('Segment noteId mismatch');
  const tx = connection.transaction('segments', 'readwrite');
  if (replace) {
    for (const key of await tx.store.index('noteId').getAllKeys(noteId)) await tx.store.delete(key);
  }
  for (const segment of segments) await tx.store.put(segment);
  await tx.done;
}

export const store: LocalStore = {
  async init() { await db(); },
  async createNote(note) { await (await db()).add('notes', note); },
  async updateNote(id, patch) { await update('notes', id, patch); },
  async getNote(id) { return (await (await db()).get('notes', id)) ?? null; },
  async listNotes(query) {
    const tx = (await db()).transaction(['notes', 'segments']);
    const notes = await tx.objectStore('notes').getAll();
    const needle = query?.toLowerCase();
    const matches = new Set<string>();
    if (needle) {
      for (const note of notes) if (note.title.toLowerCase().includes(needle)) matches.add(note.id);
      let cursor = await tx.objectStore('segments').openCursor();
      while (cursor) {
        const segment = cursor.value;
        if (!matches.has(segment.noteId) && segment.text.toLowerCase().includes(needle)) matches.add(segment.noteId);
        cursor = await cursor.continue();
      }
    }
    await tx.done;
    return notes.filter(note => !needle || note.title.toLowerCase().includes(needle) || matches.has(note.id))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  },
  async deleteNote(id) {
    const tx = (await db()).transaction(['notes', 'chunks', 'segments', 'memos', 'summaries', 'audio'], 'readwrite');
    const audio = tx.objectStore('audio');
    for (const chunk of await tx.objectStore('chunks').index('noteId').getAll(id)) {
      if (chunk.localPath) await audio.delete(chunk.localPath);
    }
    // Also remove blobs written before their chunk metadata was persisted.
    await audio.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`));
    for (const name of ['chunks', 'segments', 'memos'] as const) {
      const records = tx.objectStore(name);
      for (const key of await records.index('noteId').getAllKeys(id)) await records.delete(key);
    }
    await tx.objectStore('summaries').delete(id);
    await tx.objectStore('notes').delete(id);
    await tx.done;
  },
  async addChunk(chunk) { await (await db()).put('chunks', chunk); },
  async updateChunk(noteId, seq, patch) { await update('chunks', [noteId, seq], patch); },
  async listChunks(noteId) {
    return (await (await db()).getAllFromIndex('chunks', 'noteId', noteId)).sort((a, b) => a.seq - b.seq);
  },
  async putSegments(noteId, segments) { await writeSegments(noteId, segments, false); },
  async replaceSegments(noteId, segments) { await writeSegments(noteId, segments, true); },
  async updateSegment(id, patch) { await update('segments', id, patch); },
  async listSegments(noteId) {
    return (await (await db()).getAllFromIndex('segments', 'noteId', noteId)).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
  },
  async addMemo(memo) { await (await db()).put('memos', memo); },
  async deleteMemo(id) { await (await db()).delete('memos', id); },
  async listMemos(noteId) {
    return (await (await db()).getAllFromIndex('memos', 'noteId', noteId)).sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  },
  async putSummary(summary) { await (await db()).put('summaries', summary); },
  async getSummary(noteId) { return (await (await db()).get('summaries', noteId)) ?? null; },
  async putAudioBlob(key, blob) { await (await db()).put('audio', blob, key); },
  async getAudioBlob(key) { return (await (await db()).get('audio', key)) ?? null; },
  async deleteAudioBlob(key) { await (await db()).delete('audio', key); },
};

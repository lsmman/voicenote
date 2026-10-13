import { openDatabaseAsync, type SQLiteDatabase, type SQLiteBindValue } from 'expo-sqlite';
import type { AudioChunk, Memo, Segment } from '../core/types';
import type { LocalStore } from './types';
import { noteFromRow, segmentFromRow, summaryFromRow, type NoteRow, type SegmentRow, type SummaryRow } from './mapping';

let database: Promise<SQLiteDatabase> | undefined;
function db(): Promise<SQLiteDatabase> {
  database ??= (async () => {
    const connection = await openDatabaseAsync('voicenote.db');
    try {
      await connection.execAsync('PRAGMA journal_mode = WAL;');
      await connection.withExclusiveTransactionAsync(async tx => {
        const version = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
        if ((version?.user_version ?? 0) > 1) throw new Error('Unsupported local store version');
        if (!version?.user_version) {
          await tx.execAsync(`
            CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, userId TEXT, title TEXT NOT NULL,
              createdAt TEXT NOT NULL, durationMs INTEGER NOT NULL, status TEXT NOT NULL, modelName TEXT, gaps TEXT NOT NULL);
            CREATE TABLE chunks (noteId TEXT NOT NULL, seq INTEGER NOT NULL, startMs INTEGER NOT NULL,
              durationMs INTEGER NOT NULL, localPath TEXT, mimeType TEXT NOT NULL, remotePath TEXT,
              uploadedAt TEXT, transcribedAt TEXT, PRIMARY KEY (noteId, seq));
            CREATE TABLE segments (id TEXT PRIMARY KEY NOT NULL, noteId TEXT NOT NULL, startMs INTEGER NOT NULL,
              endMs INTEGER NOT NULL, text TEXT NOT NULL, speakerLabel TEXT, edited INTEGER NOT NULL);
            CREATE INDEX segments_noteId ON segments (noteId, startMs);
            CREATE TABLE memos (id TEXT PRIMARY KEY NOT NULL, noteId TEXT NOT NULL, atMs INTEGER NOT NULL,
              text TEXT NOT NULL, kind TEXT NOT NULL);
            CREATE INDEX memos_noteId ON memos (noteId, atMs);
            CREATE TABLE summaries (noteId TEXT PRIMARY KEY NOT NULL, summary TEXT NOT NULL,
              keywords TEXT NOT NULL, todos TEXT NOT NULL, createdAt TEXT NOT NULL);
            PRAGMA user_version = 1;
          `);
        }
      });
      return connection;
    } catch (error) { await connection.closeAsync(); throw error; }
  })().catch(error => { database = undefined; throw error; });
  return database;
}

// Serialize transactions on this connection, including read/modify/write operations.
let pending: Promise<unknown> = Promise.resolve();
function access<T>(operation: (connection: SQLiteDatabase) => Promise<T>, write = false): Promise<T> {
  const result = pending.then(async () => {
    const connection = await db();
    if (!write) return operation(connection);
    let value!: T;
    await connection.withExclusiveTransactionAsync(async tx => { value = await operation(tx); });
    return value;
  });
  pending = result.catch(() => undefined);
  return result;
}

type Table = 'notes' | 'chunks' | 'segments' | 'memos' | 'summaries';
const columns: Record<Table, string[]> = {
  notes: ['id', 'userId', 'title', 'createdAt', 'durationMs', 'status', 'modelName', 'gaps'],
  chunks: ['noteId', 'seq', 'startMs', 'durationMs', 'localPath', 'mimeType', 'remotePath', 'uploadedAt', 'transcribedAt'],
  segments: ['id', 'noteId', 'startMs', 'endMs', 'text', 'speakerLabel', 'edited'],
  memos: ['id', 'noteId', 'atMs', 'text', 'kind'],
  summaries: ['noteId', 'summary', 'keywords', 'todos', 'createdAt'],
};
function encode(key: string, value: unknown): SQLiteBindValue {
  if (['gaps', 'summary', 'keywords', 'todos'].includes(key)) return JSON.stringify(value);
  if (key === 'edited') return value ? 1 : 0;
  return value as SQLiteBindValue;
}
async function put(connection: SQLiteDatabase, table: Table, value: object, insertOnly = false) {
  const record = value as Record<string, unknown>;
  const keys = columns[table];
  const conflict = table === 'chunks' ? ['noteId', 'seq'] : table === 'summaries' ? ['noteId'] : ['id'];
  const upsert = insertOnly ? '' : ` ON CONFLICT (${conflict.join(', ')}) DO UPDATE SET ${keys.filter(key => !conflict.includes(key)).map(key => `${key} = excluded.${key}`).join(', ')}`;
  await connection.runAsync(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})${upsert}`,
    keys.map(key => encode(key, record[key])));
}
async function patch(table: Table, where: string, identity: SQLiteBindValue[], value: object) {
  await access(async connection => {
    const entries = Object.entries(value).filter(([key, value]) => columns[table].includes(key) && !['id', 'noteId', 'seq'].includes(key) && value !== undefined);
    if (!entries.length) return;
    await connection.runAsync(`UPDATE ${table} SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE ${where}`,
      [...entries.map(([key, value]) => encode(key, value)), ...identity]);
  }, true);
}
async function writeSegments(noteId: string, segments: Segment[], replace: boolean) {
  await access(async connection => {
    if (segments.some(segment => segment.noteId !== noteId)) throw new Error('Segment noteId mismatch');
    if (replace) await connection.runAsync('DELETE FROM segments WHERE noteId = ?', noteId);
    for (const segment of segments) await put(connection, 'segments', segment);
  }, true);
}

export const store: LocalStore = {
  async init() { await db(); },
  async createNote(note) { await access(connection => put(connection, 'notes', note, true), true); },
  async updateNote(id, value) { await patch('notes', 'id = ?', [id], value); },
  async getNote(id) {
    return access(async connection => {
      const row = await connection.getFirstAsync<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
      return row ? noteFromRow(row) : null;
    });
  },
  async listNotes(query) {
    return access(async connection => {
      const notes = (await connection.getAllAsync<NoteRow>('SELECT * FROM notes')).map(noteFromRow);
      const needle = query?.toLowerCase();
      const matches = new Set<string>();
      // JS case folding matches web behavior, including non-ASCII text and literal SQL wildcards.
      if (needle) for (const row of await connection.getAllAsync<{ noteId: string; text: string }>('SELECT noteId, text FROM segments')) {
        if (row.text.toLowerCase().includes(needle)) matches.add(row.noteId);
      }
      return notes.filter(note => !needle || note.title.toLowerCase().includes(needle) || matches.has(note.id))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
    });
  },
  async deleteNote(id) {
    await access(async connection => {
      for (const table of ['chunks', 'segments', 'memos', 'summaries']) await connection.runAsync(`DELETE FROM ${table} WHERE noteId = ?`, id);
      await connection.runAsync('DELETE FROM notes WHERE id = ?', id);
    }, true);
  },
  async addChunk(chunk) { await access(connection => put(connection, 'chunks', chunk), true); },
  async updateChunk(noteId, seq, value) { await patch('chunks', 'noteId = ? AND seq = ?', [noteId, seq], value); },
  async listChunks(noteId) { return access(connection => connection.getAllAsync<AudioChunk>('SELECT * FROM chunks WHERE noteId = ? ORDER BY seq', noteId)); },
  async putSegments(noteId, segments) { await writeSegments(noteId, segments, false); },
  async replaceSegments(noteId, segments) { await writeSegments(noteId, segments, true); },
  async updateSegment(id, value) { await patch('segments', 'id = ?', [id], value); },
  async listSegments(noteId) {
    return access(async connection => (await connection.getAllAsync<SegmentRow>('SELECT * FROM segments WHERE noteId = ? ORDER BY startMs, id', noteId)).map(segmentFromRow));
  },
  async addMemo(memo) { await access(connection => put(connection, 'memos', memo), true); },
  async deleteMemo(id) { await access(async connection => { await connection.runAsync('DELETE FROM memos WHERE id = ?', id); }, true); },
  async listMemos(noteId) { return access(connection => connection.getAllAsync<Memo>('SELECT * FROM memos WHERE noteId = ? ORDER BY atMs, id', noteId)); },
  async putSummary(summary) { await access(connection => put(connection, 'summaries', summary), true); },
  async getSummary(noteId) {
    return access(async connection => {
      const row = await connection.getFirstAsync<SummaryRow>('SELECT * FROM summaries WHERE noteId = ?', noteId);
      return row ? summaryFromRow(row) : null;
    });
  },
};

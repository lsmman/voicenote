/** @jest-environment node */
import 'fake-indexeddb/auto';
import { afterEach, expect, jest, test } from '@jest/globals';

// jest-expo prefers .native.ts; explicitly load the web implementation.
const { store } = jest.requireActual<typeof import('../index')>('../index.ts');
// React Native's Jest Blob mock is not structured-cloneable; use Node's real Blob.
const { Blob } = jest.requireActual<{ Blob: typeof globalThis.Blob }>('node:buffer');
// Expo preserves the Node clone before installing its native-only polyfill.
globalThis.structuredClone = (globalThis as unknown as {
  originalstructuredClone: typeof structuredClone;
}).originalstructuredClone;
import type { AudioChunk, Note, Segment, Summary } from '../../core/types';

const note = (id: string, createdAt = '2026-10-13T00:00:00Z'): Note => ({
  id, userId: null, title: `Title ${id}`, createdAt, durationMs: 0,
  status: 'recording', modelName: null, gaps: [],
});
const chunk = (noteId: string, seq: number): AudioChunk => ({
  noteId, seq, startMs: seq * 30000, durationMs: 30000, localPath: `${noteId}/${seq}`,
  mimeType: 'audio/mp4', remotePath: null, uploadedAt: null, transcribedAt: null,
});
const segment = (id: string, noteId: string, startMs: number, text = 'Hello'): Segment => ({
  id, noteId, startMs, endMs: startMs + 100, text, speakerLabel: null, edited: false,
});
const summary = (noteId: string): Summary => ({
  noteId, summary: [{ text: 'Summary', atMs: 50 }], keywords: ['one', '둘'],
  todos: [{ text: 'Next', atMs: null }], createdAt: '2026-10-13T01:00:00Z',
});

afterEach(async () => {
  for (const entry of await store.listNotes()) await store.deleteNote(entry.id);
});

test('lazy initialization and repeated concurrent init preserve notes; newest first', async () => {
  await store.createNote(note('old', '2026-10-11T00:00:00Z'));
  await Promise.all([store.init(), store.init(), store.createNote(note('new'))]);
  expect((await store.listNotes()).map(entry => entry.id)).toEqual(['new', 'old']);
  expect(await store.getNote('old')).toEqual(note('old', '2026-10-11T00:00:00Z'));
  expect(await store.getNote('missing')).toBeNull();
});

test('search matches title or segment text, case insensitively with literal substrings', async () => {
  await store.createNote({ ...note('a'), title: 'ÉCOLE meeting' });
  await store.createNote(note('b', '2026-10-12T00:00:00Z'));
  await store.putSegments('b', [segment('s1', 'b', 0, 'Discuss École: 50%_done'), segment('s2', 'b', 10, 'école')]);
  expect((await store.listNotes('éCoLe')).map(entry => entry.id)).toEqual(['a', 'b']);
  expect((await store.listNotes('%_')).map(entry => entry.id)).toEqual(['b']);
  expect(await store.listNotes('absent')).toEqual([]);
  expect(await store.listNotes('')).toHaveLength(2);
});

test('partial note updates preserve fields and identity, including concurrent updates', async () => {
  await store.createNote(note('a'));
  await Promise.all([store.updateNote('a', { title: 'Renamed' }), store.updateNote('a', { durationMs: 123 })]);
  await store.updateNote('a', { id: 'different', gaps: [{ atMs: 10, reason: 'call' }], status: 'done' });
  expect(await store.getNote('a')).toEqual({ ...note('a'), title: 'Renamed', durationMs: 123, status: 'done', gaps: [{ atMs: 10, reason: 'call' }] });
  expect(await store.getNote('different')).toBeNull();
  await store.updateNote('missing', { title: 'Ignored' });
  expect(await store.getNote('missing')).toBeNull();
});

test('chunks use compound identity and numeric seq ordering; partial updates persist', async () => {
  await store.createNote(note('a'));
  await store.createNote(note('b'));
  for (const seq of [10, 2, 0]) await store.addChunk(chunk('a', seq));
  await store.addChunk(chunk('b', 0));
  await store.updateChunk('a', 2, { remotePath: 'remote', uploadedAt: 'now', seq: 99, noteId: 'b' });
  const chunks = await store.listChunks('a');
  expect(chunks.map(entry => entry.seq)).toEqual([0, 2, 10]);
  expect(chunks[1]).toEqual({ ...chunk('a', 2), remotePath: 'remote', uploadedAt: 'now' });
  expect(await store.listChunks('b')).toEqual([chunk('b', 0)]);
});

test('segments upsert, order by startMs, update, and replace only the specified note', async () => {
  await store.createNote(note('a'));
  await store.createNote(note('b'));
  await store.putSegments('a', [segment('s1', 'a', 500), segment('s2', 'a', 100)]);
  await store.putSegments('b', [segment('s3', 'b', 0)]);
  await store.putSegments('a', [segment('s1', 'a', 50, 'Changed')]);
  await store.updateSegment('s2', { text: 'Edited', edited: true, speakerLabel: 'A' });
  expect((await store.listSegments('a')).map(entry => entry.id)).toEqual(['s1', 's2']);
  expect((await store.listSegments('a'))[1]).toEqual({ ...segment('s2', 'a', 100, 'Edited'), edited: true, speakerLabel: 'A' });
  await expect(store.replaceSegments('a', [segment('bad', 'b', 0)])).rejects.toThrow('noteId mismatch');
  expect(await store.listSegments('a')).toHaveLength(2);
  await store.replaceSegments('a', [segment('s4', 'a', 200)]);
  expect(await store.listSegments('a')).toEqual([segment('s4', 'a', 200)]);
  expect(await store.listSegments('b')).toEqual([segment('s3', 'b', 0)]);
  await store.replaceSegments('a', []);
  expect(await store.listSegments('a')).toEqual([]);
});

test('memos and summaries roundtrip and support deletion/upsert', async () => {
  await store.createNote(note('a'));
  const memo = { id: 'm1', noteId: 'a', atMs: 99, text: 'Remember', kind: 'memo' as const };
  await store.addMemo(memo);
  await store.addMemo({ ...memo, id: 'm2', atMs: 1, kind: 'bookmark' });
  expect((await store.listMemos('a')).map(entry => entry.id)).toEqual(['m2', 'm1']);
  await store.deleteMemo('m2');
  expect(await store.listMemos('a')).toEqual([memo]);
  expect(await store.getSummary('a')).toBeNull();
  await store.putSummary(summary('a'));
  expect(await store.getSummary('a')).toEqual(summary('a'));
  await store.putSummary({ ...summary('a'), keywords: [] });
  expect((await store.getSummary('a'))?.keywords).toEqual([]);
});

test('audio blob roundtrip, overwrite, missing lookup and deletion', async () => {
  const blob = new Blob([new Uint8Array([0, 1, 255, 42])], { type: 'audio/mp4' });
  await store.putAudioBlob!('audio-test', blob);
  const loaded = await store.getAudioBlob!('audio-test');
  expect(loaded?.type).toBe('audio/mp4');
  expect(await loaded?.arrayBuffer()).toEqual(await blob.arrayBuffer());
  await store.putAudioBlob!('audio-test', new Blob(['replacement']));
  expect(await (await store.getAudioBlob!('audio-test'))?.text()).toBe('replacement');
  await store.deleteAudioBlob!('audio-test');
  expect(await store.getAudioBlob!('audio-test')).toBeNull();
});

test('delete cascades all child records and audio, preserving other notes', async () => {
  for (const id of ['a', 'ab']) {
    await store.createNote(note(id));
    await store.addChunk(chunk(id, 0));
    await store.putSegments(id, [segment(`${id}-segment`, id, 0)]);
    await store.addMemo({ id: `${id}-memo`, noteId: id, atMs: 0, text: '', kind: 'bookmark' });
    await store.putSummary(summary(id));
    await store.putAudioBlob!(`${id}/0`, new Blob([id]));
  }
  await store.addChunk({ ...chunk('a', 1), localPath: 'custom-key' });
  await store.putAudioBlob!('custom-key', new Blob(['custom']));
  await store.putAudioBlob!('a/99', new Blob(['orphan']));
  await store.deleteNote('a');
  await store.deleteNote('a');
  expect(await store.getNote('a')).toBeNull();
  expect(await store.listChunks('a')).toEqual([]);
  expect(await store.listSegments('a')).toEqual([]);
  expect(await store.listMemos('a')).toEqual([]);
  expect(await store.getSummary('a')).toBeNull();
  for (const key of ['a/0', 'a/99', 'custom-key']) expect(await store.getAudioBlob!(key)).toBeNull();
  expect(await store.getNote('ab')).toEqual(note('ab'));
  expect(await store.listChunks('ab')).toHaveLength(1);
  expect(await store.listSegments('ab')).toHaveLength(1);
  expect(await store.listMemos('ab')).toHaveLength(1);
  expect(await store.getSummary('ab')).toEqual(summary('ab'));
  expect(await (await store.getAudioBlob!('ab/0'))?.text()).toBe('ab');
});

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import type { SyncService } from './types';
import { resolveLocalPath } from '../recorder/paths';
import { chunkFromRow, chunkToRow, memoFromRow, memoToRow, noteFromRow, noteToRow, segmentFromRow, segmentToRow, summaryFromRow, summaryToRow } from './mapping';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const isSyncConfigured: boolean = !!supabaseUrl && !!supabaseAnonKey;
const syncUnavailable = () => new Error('동기화가 설정되지 않았습니다');

function createLocalClient(): ReturnType<typeof createClient> {
  // Preserve chained query APIs while rejecting only when their result is awaited.
  const unavailable: unknown = new Proxy(() => unavailable, {
    get(_target, key) {
      if (key === 'then') {
        return (resolve: (value: never) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.reject(syncUnavailable()).then(resolve, reject);
      }
      return unavailable;
    },
  });
  const auth = new Proxy({
    async getSession() { return { data: { session: null } }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  }, {
    get(target, key) { return key in target ? Reflect.get(target, key) : unavailable; },
  });
  return new Proxy({ auth }, {
    get(target, key) { return key === 'auth' ? target.auth : unavailable; },
  }) as unknown as ReturnType<typeof createClient>;
}

export const supabase = isSyncConfigured ? createClient(
  supabaseUrl!,
  supabaseAnonKey!,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' } },
) : createLocalClient();

async function requireSession() {
  if (!isSyncConfigured) throw syncUnavailable();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('로그인이 필요합니다.');
  return data.session;
}

export const sync: SyncService = {
  async uploadChunk(chunk) {
    const { user } = await requireSession();
    if (!chunk.localPath) throw new Error('오디오 파일이 없습니다.');
    if (!/^[\w-]+$/.test(chunk.noteId) || !Number.isSafeInteger(chunk.seq) || chunk.seq < 0) {
      throw new Error('잘못된 청크 경로입니다.');
    }
    const mime = chunk.mimeType.split(';')[0].trim().toLowerCase();
    const ext = ({ 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg' } as Record<string, string>)[mime];
    if (!ext) throw new Error(`지원하지 않는 오디오 형식: ${mime}`);
    let body: Blob | ArrayBuffer;
    if (Platform.OS === 'web') {
      const { store } = await import('../store');
      const blob = await store.getAudioBlob?.(chunk.localPath);
      if (!blob) throw new Error('저장된 오디오가 없습니다.');
      body = blob;
    } else {
      // Supabase recommends ArrayBuffer rather than Blob/FormData on React Native.
      const response = await fetch(resolveLocalPath(chunk.localPath));
      if (!response.ok) throw new Error('오디오 파일을 읽지 못했습니다.');
      body = await response.arrayBuffer();
    }
    const path = `${user.id}/${chunk.noteId}/${chunk.seq}.${ext}`;
    const { error } = await supabase.storage.from('audio').upload(path, body, { contentType: mime, upsert: true });
    if (error) throw error;
    return path;
  },
  async pushNote(note, segments, memos, summary) {
    const { user } = await requireSession();
    if ((note.userId && note.userId !== user.id) || segments.some(s => s.noteId !== note.id)
      || memos.some(m => m.noteId !== note.id) || (summary && summary.noteId !== note.id)) {
      throw new Error('노트 소유자 또는 연결된 데이터가 일치하지 않습니다.');
    }
    const { error } = await supabase.rpc('sync_push_note', {
      p_note: noteToRow(note, user.id), p_segments: segments.map(segmentToRow),
      p_memos: memos.map(memoToRow), p_summary: summary ? summaryToRow(summary) : null,
    });
    if (error) throw error;
  },
  async pushChunks(chunks) {
    const { user } = await requireSession();
    if (chunks.some(chunk => !chunk.remotePath)) throw new Error('업로드되지 않은 청크입니다.');
    // Device-local paths are meaningless elsewhere; only the remote path is shared.
    const rows = chunks.map(chunk => ({ ...chunkToRow({ ...chunk, localPath: null }), user_id: user.id }));
    const { error } = await supabase.from('audio_chunks').upsert(rows);
    if (error) throw error;
  },
  async pullChunks(noteId) {
    await requireSession();
    const { data, error } = await supabase.from('audio_chunks').select('*').eq('note_id', noteId).order('seq');
    if (error) throw error;
    return data.map(chunkFromRow);
  },
  async pullNotes() {
    await requireSession();
    // Page beyond PostgREST's default 1,000-row limit.
    const notes = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await supabase.from('notes').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 499);
      if (error) throw error;
      notes.push(...data.map(noteFromRow));
      if (data.length < 500) return notes;
    }
  },
  async pullNoteDetail(noteId) {
    await requireSession();
    // One SQL snapshot; JSON aggregation also avoids truncating long transcripts.
    const { data, error } = await supabase.rpc('sync_pull_note_detail', { p_note_id: noteId });
    if (error) throw error;
    if (!data) throw new Error('노트를 찾을 수 없습니다.');
    return { segments: data.segments.map(segmentFromRow), memos: data.memos.map(memoFromRow), summary: data.summary ? summaryFromRow(data.summary) : null };
  },
  async chunkUrl(remotePath) {
    await requireSession();
    const { data, error } = await supabase.storage.from('audio').createSignedUrl(remotePath, 3600);
    if (error) throw error;
    return data.signedUrl;
  },
  async summarize(req) {
    const { data: { session } } = await supabase.auth.getSession();
    const base = (process.env.EXPO_PUBLIC_API_BASE ?? (Platform.OS === 'web' ? '' : 'https://voicenote-ten-alpha.vercel.app')).replace(/\/$/, '');
    const response = await fetch(`${base}/api/summarize`, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', 'x-voicenote-client': 'app',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      }, body: JSON.stringify(req),
    });
    if (response.status === 429) throw Object.assign(new Error('요약 요청이 많아요. 잠시 후 다시 시도해 주세요'), { status: 429 });
    if (!response.ok) throw new Error(`요약 요청 실패 (${response.status})`);
    return response.json();
  },
};

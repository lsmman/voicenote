import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { Link, Stack, router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { pipeline, store } from '../services';
import { useSession } from '../ui/useSession';
import { pullMissingNotes } from '../ui/pullNotes';
import type { Note } from '../core/types';
import { formatDate, formatTime, statusLabel } from '../ui/format';
import { Button, Input, Notice, Screen } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';

export default function NotesScreen() {
  const c = useTheme(); const { session } = useSession(); const task = useTask();
  const [notes, setNotes] = useState<Note[]>([]); const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false); const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const request = useRef(0);
  const load = useCallback(async () => {
    const version = ++request.current;
    try { const result = await store.listNotes(query); if (version === request.current) { setNotes(result); setLoaded(true); } }
    catch { if (version === request.current) task.setError('노트를 불러오지 못했어요. 새로고침해 주세요.'); }
  }, [query, task.setError]);
  useFocusEffect(useCallback(() => { void load(); const timer = setInterval(() => { void load(); }, 4000); return () => { clearInterval(timer); request.current++; }; }, [load]));
  useEffect(() => pipeline.onNoteProgress((id: string, done: number, total: number) => {
    setProgress(old => ({ ...old, [id]: { done, total } }));
    void load();
  }), [load]);
  const refresh = async () => {
    setRefreshing(true); task.setError('');
    try { if (session) await pullMissingNotes(); await load(); }
    catch { task.setError('동기화하지 못했어요. 기기에 저장된 노트는 계속 사용할 수 있어요.'); await load(); }
    finally { setRefreshing(false); }
  };
  const importFile = () => task.run(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const file = result.assets[0];
    const id = await pipeline.importFile(file.uri, file.name, file.mimeType ?? 'audio/mpeg');
    router.push({ pathname: '/note/[id]', params: { id } });
  }, '파일을 가져오지 못했어요. 지원되는 오디오 파일인지 확인해 주세요.');
  return <Screen>
    <Stack.Screen options={{ headerRight: () => <Link href="/settings" accessibilityLabel="설정" style={{ padding: 14, color: c.accent, fontSize: 16 }}>설정</Link> }} />
    <View style={styles.content}>
      <Text style={[styles.title, { color: c.text }]}>말을 담고, 생각을 남겨요</Text>
      <Input accessibilityLabel="노트 검색" placeholder="제목이나 전사문 검색" value={query} onChangeText={setQuery} returnKeyType="search" />
      <View style={styles.row}><Button title={task.busy ? '가져오는 중…' : '파일 가져오기'} onPress={() => { void importFile(); }} disabled={task.busy} /><Button title="새로고침" onPress={() => { void refresh(); }} disabled={refreshing} /></View>
      {!!task.error && <Notice text={task.error} error />}
    </View>
    <FlatList data={notes} keyExtractor={item => item.id} refreshing={refreshing} onRefresh={() => { void refresh(); }} contentContainerStyle={[styles.content, { paddingBottom: 110, flexGrow: 1 }]}
      ListEmptyComponent={<Notice text={loaded ? query ? '검색 결과가 없어요.' : '아직 노트가 없어요. 첫 녹음을 시작해 보세요.' : '노트를 불러오는 중이에요.'} />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${statusLabel(item.status, progress[item.id])}`} onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.heading, { color: c.text }]} numberOfLines={2}>{item.title || '제목 없는 노트'}</Text>
        <Text style={[styles.small, { color: c.muted }]}>{formatDate(item.createdAt)} · {formatTime(item.durationMs)}</Text>
        <Text style={{ color: item.status === 'error' ? c.danger : c.accent, alignSelf: 'flex-start', backgroundColor: c.soft, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 }}>{statusLabel(item.status, progress[item.id])}</Text>
      </Pressable>} />
    <View style={{ position: 'absolute', bottom: 28, right: 24 }}><Button title="●  녹음" primary onPress={() => router.push('/record')} /></View>
  </Screen>;
}

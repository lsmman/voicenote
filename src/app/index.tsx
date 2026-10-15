import { t, useT } from '../i18n';
import { StatusBadge } from '../ui/StatusBadge';
import { ModelBanner } from '../ui/ModelBanner';
import { useModelState } from '../ui/useModelState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, Text, View } from 'react-native';
import { Link, Stack, router, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { engine, pipeline, store } from '../services';
import { useSession } from '../ui/useSession';
import { pullMissingNotes } from '../ui/pullNotes';
import { hasSeenWelcome } from '../components/landing/seen';
import type { Note } from '../core/types';
import { formatDate, formatTime, statusLabel } from '../ui/format';
import { Button, Input, Notice, Screen } from '../ui/primitives';
import { shadow, styles, type, useIsDark, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';

export default function NotesScreen() {
  useT();
  const c = useTheme(); const dark = useIsDark(); const { session } = useSession(); const task = useTask();
  const modelState = useModelState();
  const [waitingModels, setWaitingModels] = useState<Set<string>>(new Set());
  const label = (note: Note) => note.status === 'transcribing' && modelState?.kind !== 'ready' && waitingModels.has(note.id) ? t('modelPreparing') : statusLabel(note.status, progress[note.id]);
  const [notes, setNotes] = useState<Note[]>([]); const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false); const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const request = useRef(0); const openingRecord = useRef(false);
  const [liveRecording, setLiveRecording] = useState(false);
  useEffect(() => pipeline.subscribe(state => setLiveRecording(!!state)), []);
  useFocusEffect(useCallback(() => { openingRecord.current = false; }, []));
  const openRecord = () => { if (openingRecord.current) return; openingRecord.current = true; router.navigate('/record'); };
  const load = useCallback(async () => {
    const version = ++request.current;
    try {
      const result = await store.listNotes(query);
      const waiting = await Promise.all(result.filter(n => n.status === 'transcribing').map(async n => {
        const pending = (await store.listChunks(n.id)).some(chunk => chunk.transcribedAt === null);
        return pending && (!n.modelName || !await engine.isModelReady(n.modelName)) ? n.id : null;
      }));
      if (version === request.current) { setNotes(result); setWaitingModels(new Set(waiting.filter((id): id is string => id !== null))); setLoaded(true); }
    }
    catch { if (version === request.current) task.setError(t('notesRefreshError')); }
  }, [query, task.setError]);
  useFocusEffect(useCallback(() => { void load(); const timer = setInterval(() => { void load(); }, 4000); return () => { clearInterval(timer); request.current++; }; }, [load]));
  useEffect(() => pipeline.onNoteProgress((id: string, done: number, total: number) => {
    setProgress(old => ({ ...old, [id]: { done, total } }));
    void load();
  }), [load]);
  const refresh = async () => {
    setRefreshing(true); task.setError('');
    try { if (session) await pullMissingNotes(); await load(); }
    catch { task.setError(t('syncLocalError')); await load(); }
    finally { setRefreshing(false); }
  };
  // First visit on a fresh browser/device with no notes opens the landing page.
  useEffect(() => { void (async () => {
    if (await hasSeenWelcome() || (await store.listNotes()).length) return;
    router.replace('/welcome');
  })().catch(() => undefined); }, []);
  // A fresh browser/device shows the account's notes as soon as it is signed in.
  useEffect(() => { if (session) void pullMissingNotes().then(load).catch(() => undefined); }, [session?.user.id]);
  const importFile = () => task.run(async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true, multiple: false });
    if (result.canceled) return;
    const file = result.assets[0];
    try {
      const id = await pipeline.importFile(file.uri, file.name, file.mimeType ?? 'audio/mpeg');
      router.push({ pathname: '/note/[id]', params: { id } });
    } finally { if (Platform.OS === 'web' && file.uri.startsWith('blob:')) URL.revokeObjectURL(file.uri); }
  }, t('importError'));
  return <Screen>
    <Stack.Screen options={{ headerRight: () => <Link href="/settings" accessibilityLabel={t('settings')} style={{ padding: 10, borderRadius: 10, color: c.textSecondary, fontSize: 15, fontWeight: '500' }}>{t('settings')}</Link> }} />
    <View style={styles.content}>
      <Text style={[styles.title, { color: c.text }]}>{t('homeTitle')}</Text>
      {liveRecording && <View style={styles.card}><Notice text={t('recordingExists')} /><Link href="/record" onPress={event => { event.preventDefault(); openRecord(); }} style={{ color: c.accent, padding: 12 }}>{t('return')}</Link></View>}
      <Input variant="search" accessibilityLabel={t('searchNotes')} placeholder={t('searchPlaceholder')} value={query} onChangeText={setQuery} returnKeyType="search" />
      <View style={styles.row}><Button compact title={task.busy ? t('importing') : t('importFile')} onPress={() => { void importFile(); }} disabled={task.busy} /><Button compact title={t('refresh')} onPress={() => { void refresh(); }} disabled={refreshing} /></View>
      {!!task.error && <Notice text={task.error} error />}
    </View>
    <FlatList data={notes} keyExtractor={item => item.id} refreshing={refreshing} onRefresh={() => { void refresh(); }} contentContainerStyle={[styles.content, { paddingBottom: 110, flexGrow: 1, gap: 8 }]}
      ListHeaderComponent={<ModelBanner />}
      ListEmptyComponent={<Notice empty text={loaded ? query ? t('searchEmpty') : t('notesEmpty') : t('notesLoading')} />}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.title}, ${label(item)}`} onPress={() => router.push({ pathname: '/note/[id]', params: { id: item.id } })} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? c.subtle : c.surface, borderColor: c.border, paddingVertical: 14, gap: 6 }]}>
        <Text style={[type.rowTitle, { color: c.text }]} numberOfLines={2}>{item.title || t('untitledNote')}</Text>
        <Text style={[styles.small, { color: c.muted, fontVariant: ['tabular-nums'] }]}>{formatDate(item.createdAt)} · {formatTime(item.durationMs)}</Text>
        <StatusBadge status={item.status} text={label(item)} />
      </Pressable>} />
    <View style={{ position: 'absolute', bottom: 24, right: 20 }}><Button title={t('recordButton')} ink recordDot style={{ height: 52, paddingHorizontal: 22, borderRadius: 999, ...shadow(dark).md }} onPress={openRecord} /></View>
  </Screen>;
}

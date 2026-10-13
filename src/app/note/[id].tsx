import { StatusBadge } from '../../ui/StatusBadge';
import { ModelBanner } from '../../ui/ModelBanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { engine, pipeline, store } from '../../services';
import { useSession } from '../../ui/useSession';
import type { AudioChunk, Memo, Note, Segment, Summary } from '../../core/types';
import type { ModelInfo } from '../../transcriber/types';
import { ChunkPlayer, type ChunkPlayerHandle } from '../../components/ChunkPlayer';
import { SegmentRow } from '../../components/SegmentRow';
import { segmentsChanged, shouldPollNote } from '../../ui/noteUpdates';
import { segmentAtTime } from '../../components/playerMath';
import { confirmAction, exportNote } from '../../ui/actions';
import { formatTimestamp, statusLabel } from '../../ui/format';
import { Button, Input, Notice, Screen } from '../../ui/primitives';
import { shadow, styles, type, useIsDark, useTheme } from '../../ui/theme';
import { pullMissingDetail } from '../../ui/pullNotes';
import { useTask } from '../../ui/useTask';
export default function NoteScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>(); const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const c = useTheme(); const dark = useIsDark(); const { width } = useWindowDimensions(); const task = useTask(); const { session } = useSession();
  const [note, setNote] = useState<Note | null>(null); const [loaded, setLoaded] = useState(false); const [title, setTitle] = useState('');
  const titleDirty = useRef(false); const previousId = useRef(''); const loadVersion = useRef(0);
  const [chunks, setChunks] = useState<AudioChunk[]>([]); const [segments, setSegments] = useState<Segment[]>([]); const [memos, setMemos] = useState<Memo[]>([]); const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState<'요약' | '전사문' | '메모'>('요약'); const [active, setActive] = useState<string | undefined>(undefined);
  const segmentSnapshot = useRef<Segment[]>([]); const activeId = useRef<string | undefined>(undefined);
  const onPosition = useCallback((ms: number) => {
    const next = segmentAtTime(segmentSnapshot.current, ms)?.id;
    if (next !== activeId.current) { activeId.current = next; setActive(next); }
  }, []);
  const [edit, setEdit] = useState<Segment | null>(null); const [models, setModels] = useState<ModelInfo[] | null>(null); const [exporting, setExporting] = useState(false);
  const player = useRef<ChunkPlayerHandle>(null);
  const load = useCallback(async (forceSegments = false) => {
    if (!id) return;
    const version = ++loadVersion.current;
    try {
      const [nextNote, nextChunks, nextSegments, nextMemos, nextSummary] = await Promise.all([store.getNote(id), store.listChunks(id), store.listSegments(id), store.listMemos(id), store.getSummary(id)]);
      if (version !== loadVersion.current) return;
      if (previousId.current !== id) { titleDirty.current = false; previousId.current = id; forceSegments = true; activeId.current = undefined; setActive(undefined); }
      setNote(nextNote); if (!titleDirty.current) setTitle(nextNote?.title ?? '');
      setChunks(nextChunks);
      if (forceSegments || segmentsChanged(segmentSnapshot.current, nextSegments)) { segmentSnapshot.current = nextSegments; setSegments(nextSegments); } setMemos([...nextMemos].sort((a, b) => a.atMs - b.atMs)); setSummary(nextSummary); setLoaded(true);
    } catch { task.setError('노트를 불러오지 못했어요. 다시 시도해 주세요.'); }
  }, [id, task.setError]);
  useFocusEffect(useCallback(() => {
    void load();
    const unsubscribe = pipeline.onNoteProgress((noteId: string) => { if (noteId === id) void load(); });
    return () => { unsubscribe(); loadVersion.current++; player.current?.pause(); };
  }, [id, load]));
  const polling = shouldPollNote(note?.status);
  useFocusEffect(useCallback(() => {
    if (!polling) return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [polling, load]));
  useEffect(() => {
    if (!session || note?.userId !== session.user.id) return;
    let active = true;
    void pullMissingDetail(id).then(() => { if (active) void load(true); }).catch(() => { if (active) task.setError('동기화하지 못했어요. 새로고침으로 다시 시도해 주세요.'); });
    return () => { active = false; };
  }, [id, session?.user.id, note?.userId, load, task.setError]);
  const seek = useCallback((ms: number) => player.current?.seek(ms, true), []);
  const editSegment = useCallback((segment: Segment) => setEdit({ ...segment }), []);
  const saveTitle = () => task.run(async () => {
    const value = title.trim() || '제목 없는 노트'; await store.updateNote(id, { title: value }); titleDirty.current = false; setTitle(value); await load();
  }, '제목을 저장하지 못했어요. 다시 시도해 주세요.');
  const retranscribe = (model: ModelInfo) => task.run(async () => {
    const edited = (await store.listSegments(id)).some(segment => segment.edited);
    if (!await confirmAction(edited ? '직접 수정한 전사문이 있어요. 다시 전사하면 수정 내용이 덮어써져요. 계속할까요?' : `${model.label} 모델로 전사를 다시 시작할까요?`, '다시 전사')) return;
    await pipeline.retranscribe(id, model.id); setModels(null); await load();
  }, '전사를 다시 시작하지 못했어요. 설정에서 모델 다운로드 상태를 확인해 주세요.');
  const refreshRemote = () => task.run(async () => {
    if (session && note?.userId === session.user.id) await pullMissingDetail(id);
    await load(true);
  }, '노트를 동기화하지 못했어요. 연결 상태를 확인해 주세요.');
  const modal = !!edit || !!models || exporting;
  return <Screen>
    <View style={[styles.content, { paddingBottom: 8 }]}>
      {!!task.error && <Notice text={task.error} error />}
      {!note ? <><Notice text={loaded ? '노트를 찾을 수 없어요.' : '노트를 불러오는 중이에요.'} /><Button title="다시 불러오기" onPress={() => { void load(); }} /></> : <>
        <Input variant="title" accessibilityLabel="노트 제목" value={title} onChangeText={value => { titleDirty.current = true; setTitle(value); }} onSubmitEditing={() => { void saveTitle(); }} />
        <View style={styles.row}><Button ghost compact title="제목 저장" disabled={task.busy || title === note.title} onPress={() => { void saveTitle(); }} /><Button ghost compact title="내보내기" onPress={() => setExporting(true)} /><Button ghost compact title="새로고침" disabled={task.busy} onPress={() => { void refreshRemote(); }} /><View style={{ marginLeft: 'auto' }}><StatusBadge status={note.status} text={statusLabel(note.status)} /></View></View>
        {note.status === 'error' && <Notice error text="처리 중 오류가 생겼어요. 전사문 탭에서 전사를 다시 하거나 요약 탭에서 다시 시도할 수 있어요." />}
        <ChunkPlayer key={id} ref={player} chunks={chunks} memos={memos} onPosition={onPosition} />
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: c.border }}>{(['요약', '전사문', '메모'] as const).map(value => <Pressable key={value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => setTab(value)} style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: tab === value ? c.text : c.muted, fontWeight: '600', fontSize: 15 }}>{value}</Text>{tab === value && <View style={{ position: 'absolute', bottom: -1, left: 12, right: 12, height: 2, borderRadius: 1, backgroundColor: c.text }} />}</Pressable>)}</View>
      </>}
    </View>
    {!!note && (tab === '전사문' ? <FlatList data={segments} extraData={active} keyExtractor={item => item.id} contentContainerStyle={styles.content} ListHeaderComponent={<>{note.status === 'transcribing' && <ModelBanner />}<Button compact style={{ alignSelf: 'flex-start' }} title="전사 다시 하기" disabled={task.busy} onPress={() => { void task.run(async () => { setModels(engine.listModels()); }); }} /><Text style={[styles.small, { color: c.muted, marginTop: 8 }]}>문장을 누르면 재생돼요. 길게 누르면 내용과 화자를 수정할 수 있어요.</Text>{note.gaps.map((gap, index) => <Notice key={index} text={`${formatTimestamp(gap.atMs)} · 녹음이 중단된 구간이 있어요.`} />)}</>} ListEmptyComponent={<Notice text="전사문이 아직 없어요. 전사 대기 중이거나 모델 다운로드가 필요할 수 있어요." />}
      renderItem={({ item }) => <SegmentRow item={item} active={active === item.id} onSeek={seek} onEdit={editSegment} />} /> : tab === '메모' ? <FlatList data={memos} keyExtractor={item => item.id} contentContainerStyle={styles.content} ListEmptyComponent={<Notice text="녹음 중 남긴 메모와 북마크가 여기에 모여요." />} renderItem={({ item }) => <View style={styles.plainRow}><Pressable accessibilityRole="button" onPress={() => seek(item.atMs)} style={{ minHeight: 48, flexDirection: 'row', gap: 12 }}><Text style={[type.caption, { width: 52, paddingTop: 5, color: c.textMuted, fontVariant: ['tabular-nums'] }]}>[{formatTimestamp(item.atMs)}]</Text><View style={{ flex: 1, gap: 4 }}><Text style={[type.caption, { alignSelf: 'flex-start', color: c.textSecondary, backgroundColor: c.subtle, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }]}>{item.kind === 'bookmark' ? <><Text style={{ color: c.bookmark }}>★</Text> 북마크</> : '메모'}</Text><Text style={[type.reading, { color: c.text }]}>{item.text}</Text></View></Pressable><Button title="삭제" ghost compact style={{ alignSelf: 'flex-end' }} danger disabled={task.busy} onPress={() => { void task.run(async () => { if (await confirmAction('이 메모를 삭제할까요?', '삭제')) { await store.deleteMemo(item.id); await load(); } }); }} /></View>} /> : <ScrollView contentContainerStyle={styles.content}>
      {summary ? <>
        <Text style={[type.eyebrow, { color: c.textMuted, marginTop: 8 }]}>핵심 요약</Text>
        {summary.summary.map((item, index) => <Pressable key={index} accessibilityRole={item.atMs === null ? 'text' : 'button'} disabled={item.atMs === null} onPress={() => item.atMs !== null && seek(item.atMs)} style={[styles.plainRow, { paddingLeft: 18 }]}><View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 21, width: 6, height: 6, borderRadius: 3, backgroundColor: c.textMuted }} /><Text style={[type.reading, { color: c.text }]}>{item.text}</Text>{item.atMs !== null && <Text style={[type.caption, { color: c.accentText, backgroundColor: c.accentSoft, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 4, fontVariant: ['tabular-nums'] }]}>{formatTimestamp(item.atMs)}부터 듣기</Text>}</Pressable>)}
        <View style={styles.row}>{summary.keywords.map((keyword, index) => <Text key={index} style={{ color: c.textSecondary, backgroundColor: c.subtle, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, fontSize: 13, lineHeight: 18, fontWeight: '500' }}>{keyword}</Text>)}</View>
        <Text style={[type.eyebrow, { color: c.textMuted, marginTop: 8 }]}>할 일</Text>
        {!summary.todos.length && <Text style={{ color: c.muted }}>추출된 할 일이 없어요.</Text>}
        {summary.todos.map((item, index) => <Pressable key={index} accessibilityRole={item.atMs === null ? 'text' : 'button'} disabled={item.atMs === null} onPress={() => item.atMs !== null && seek(item.atMs)} style={styles.plainRow}><Text style={[type.reading, { color: c.text }]}>□ {item.text}</Text>{item.atMs !== null && <Text style={[type.caption, { color: c.accentText, backgroundColor: c.accentSoft, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginTop: 4, fontVariant: ['tabular-nums'] }]}>{formatTimestamp(item.atMs)}부터 듣기</Text>}</Pressable>)}
      </> : <Notice text="아직 요약이 없어요. 전사가 끝난 뒤 요약을 만들어 보세요." />}
      {note.status === 'done' && <Button title={summary ? '요약 다시 만들기' : '요약 만들기'} disabled={task.busy} onPress={() => { void task.run(async () => {
        try { await pipeline.resummarize(id); }
        catch (error) {
          if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
            task.setError('요약 요청이 많아요. 잠시 후 다시 시도해 주세요');
          } else { throw error; }
        } finally { await load(); }
      }, '요약을 만들지 못했어요. 잠시 후 다시 시도해 주세요. 전사문은 저장돼 있어요.'); }} />}
    </ScrollView>)}
    <Modal visible={modal} transparent animationType="slide" onRequestClose={() => { if (!task.busy) { setEdit(null); setModels(null); setExporting(false); } }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }}>
        <View accessibilityViewIsModal style={{ maxHeight: '85%', backgroundColor: c.surfaceRaised, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: c.border, paddingTop: 8, paddingBottom: 24, ...shadow(dark).lg, ...(Platform.OS === 'web' && width >= 768 ? { alignSelf: 'center', maxWidth: 520, width: '100%', borderRadius: 20, marginVertical: 'auto' } : {}) }}><View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: 'center', marginBottom: 8 }} /><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          {!!task.error && <Notice error text={task.error} />}
          {edit && <><Text style={[styles.heading, { color: c.text, fontVariant: ['tabular-nums'] }]}>전사문 편집 · {formatTimestamp(edit.startMs)}</Text><Input accessibilityLabel="화자 이름" placeholder="화자 이름 (선택)" value={edit.speakerLabel ?? ''} onChangeText={value => setEdit(old => old && ({ ...old, speakerLabel: value }))} /><Input accessibilityLabel="전사문 내용" multiline style={[type.reading, { minHeight: 140, padding: 12, textAlignVertical: 'top' }]} value={edit.text} onChangeText={value => setEdit(old => old && ({ ...old, text: value }))} /><Button title="저장" primary disabled={task.busy || !edit.text.trim()} onPress={() => { void task.run(async () => { await store.updateSegment(edit.id, { text: edit.text.trim(), speakerLabel: edit.speakerLabel?.trim() || null, edited: true }); setEdit(null); await load(true); }, '수정 내용을 저장하지 못했어요. 다시 시도해 주세요.'); }} /></>}
          {models && <><Text style={[styles.heading, { color: c.text }]}>다시 전사할 모델</Text>{!models.length && <Notice text="사용 가능한 모델이 없어요. 설정에서 확인해 주세요." />}{models.map(model => <Button ghost style={{ minHeight: 52, alignItems: 'flex-start', borderBottomWidth: 1, borderColor: c.border }} key={model.id} title={`${model.label} · ${Math.round(model.sizeBytes / 1024 / 1024)} MB`} disabled={task.busy} onPress={() => { void retranscribe(model); }} />)}</>}
          {exporting && note && <><Text style={[styles.heading, { color: c.text }]}>노트 내보내기</Text>{(['txt', 'md'] as const).map(format => <Button ghost style={{ minHeight: 52, alignItems: 'flex-start', borderBottomWidth: 1, borderColor: c.border }} key={format} title={format === 'txt' ? '텍스트 (.txt)' : '마크다운 (.md)'} disabled={task.busy} onPress={() => { void task.run(async () => { await exportNote({ note, summary, segments, memos }, format); setExporting(false); }, '노트를 내보내지 못했어요. 다시 시도해 주세요.'); }} />)}</>}
          <Button ghost title="닫기" disabled={task.busy} onPress={() => { setEdit(null); setModels(null); setExporting(false); }} />
        </ScrollView></View>
      </KeyboardAvoidingView>
    </Modal>
  </Screen>;
}

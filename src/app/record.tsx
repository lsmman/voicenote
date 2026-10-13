import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { startOrAttachRecording, webLocks } from '../ui/recordingSession';
import { pipeline } from '../services';
import type { LiveSessionState } from '../pipeline/types';
import type { RecorderWarning } from '../recorder/types';
import { confirmAction } from '../ui/actions';
import { formatTime, formatTimestamp } from '../ui/format';
import { Button, Input, Notice, Screen } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
const warningText = (warning: RecorderWarning) => ({ 'mic-ended': '마이크가 끊겼어요', silence: '10초 이상 소리가 없어요', 'low-storage': '저장공간이 부족해요. 공간을 확보해 주세요.', interrupted: '녹음이 잠시 중단됐어요. 마이크 상태를 확인해 주세요.' })[warning.kind];
export default function RecordScreen() {
  const c = useTheme(); const task = useTask(); const navigation = useNavigation();
  const [live, setLive] = useState<LiveSessionState | null>(null);
  const [noteId, setNoteId] = useState(''); const [starting, setStarting] = useState(true);
  const [startError, setStartError] = useState(false); const [memo, setMemo] = useState(''); const [attached, setAttached] = useState('');
  const finished = useRef(false);
  const startPromise = useRef<Promise<string> | null>(null); const transcript = useRef<ScrollView>(null);
  useEffect(() => {
    let alive = true;
    const unsubscribe = pipeline.subscribe((state: LiveSessionState | null) => {
      if (alive) { setLive(state); if (state) { setNoteId(state.noteId); } }
    });
    // Returning through browser history must reattach to the live recording.
    if (!startPromise.current) startPromise.current = startOrAttachRecording(pipeline, webLocks(Platform.OS === 'web'));
    startPromise.current.then(id => { if (alive) setNoteId(id); }).catch(error => { if (alive) { setStartError(true); if (error instanceof Error && error.message.includes('다른 탭')) task.setError(error.message); } }).finally(() => { if (alive) setStarting(false); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  const blocking = starting || !!live;
  usePreventRemove(Platform.OS === 'web' && blocking, ({ data }) => {
    if (finished.current) { navigation.dispatch(data.action); return; }
    void confirmAction('녹음이 진행 중이에요. 화면을 떠나도 녹음은 계속돼요. 나갈까요?', '나가기').then(leave => { if (leave) navigation.dispatch(data.action); });
  });
  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => blocking);
    const unload = (event: BeforeUnloadEvent) => { if (blocking) { event.preventDefault(); event.returnValue = ''; } };
    if (Platform.OS === 'web') window.addEventListener('beforeunload', unload);
    return () => { back.remove(); if (Platform.OS === 'web') window.removeEventListener('beforeunload', unload); };
  }, [blocking]);
  const addMemo = (kind: 'memo' | 'bookmark') => task.run(async () => {
    if (kind === 'memo' && !memo.trim()) return;
    const result = await pipeline.addMemo(kind === 'memo' ? memo.trim() : '', kind);
    if (kind === 'memo') setMemo('');
    setAttached(`${formatTimestamp(result.atMs)}에 ${kind === 'bookmark' ? '북마크' : '메모'}를 남겼어요.`);
  }, '메모를 저장하지 못했어요. 다시 시도해 주세요.');
  const stop = () => task.run(async () => {
    if (!await confirmAction('녹음을 마치고 노트를 저장할까요?', '녹음 종료')) return;
    await pipeline.stopRecording();
    finished.current = true;
    router.replace({ pathname: '/note/[id]', params: { id: noteId } });
  }, '녹음을 종료하지 못했어요. 저장된 부분은 유지돼요. 다시 시도해 주세요.');
  const active = !!noteId && !!live && (live.state === 'recording' || live.state === 'paused');
  return <Screen><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={96}>
    <View style={[styles.content, { paddingBottom: 8 }]}>
      {Platform.OS === 'web' && <Notice text="모바일 브라우저에서는 화면을 끄면 녹음이 멈출 수 있어요. 화면과 이 탭을 켜 두세요." />}
      {startError && <><Notice error text="녹음을 시작하지 못했어요. 마이크 권한과 저장공간을 확인해 주세요." />{Platform.OS !== 'web' && <Button title="기기 설정 열기" onPress={() => { void task.run(() => Linking.openSettings()); }} />}<Button title="목록으로" onPress={() => router.replace('/')} /></>}
      <Text accessibilityLabel="녹음 시간" style={{ color: c.text, fontSize: 46, textAlign: 'center', fontVariant: ['tabular-nums'], fontWeight: '600' }}>{formatTime(live?.elapsedMs ?? 0)}</Text>
      <Text style={{ color: c.muted, textAlign: 'center' }}>{starting ? '마이크 준비 중…' : live?.state === 'paused' ? '일시정지' : active ? '녹음 중' : '녹음이 종료됐어요'}</Text>
      <View accessibilityLabel="마이크 음량" accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round((live?.level ?? 0) * 100) }} style={{ height: 10, borderRadius: 5, backgroundColor: c.border, overflow: 'hidden' }}><View style={{ width: `${Math.min(100, Math.max(0, (live?.level ?? 0) * 100))}%`, height: 10, backgroundColor: c.accent }} /></View>
      <Text style={[styles.small, { color: c.muted }]}>전사 대기 {live?.pendingChunks ?? 0}</Text>
      {Array.from(new Map((live?.warnings ?? []).map(w => [w.kind, w])).values()).map(w => <Notice key={w.kind} error text={warningText(w)} />)}
    </View>
    <ScrollView ref={transcript} style={{ flex: 1 }} contentContainerStyle={styles.content} onContentSizeChange={() => transcript.current?.scrollToEnd({ animated: true })}>
      {live?.liveSegments.slice(-20).map(segment => <Text key={segment.id} style={[styles.body, { color: c.text }]}>{segment.text}</Text>)}
      {!live?.liveSegments.length && <Text style={[styles.body, { color: c.muted }]}>녹음한 말이 여기에 차곡차곡 나타나요.</Text>}
    </ScrollView>
    <View style={[styles.content, { backgroundColor: c.surface }]}>
      {!!task.error && <Notice error text={task.error} />}
      {!!attached && <Text accessibilityLiveRegion="polite" style={{ color: c.accent }}>{attached}</Text>}
      <Input accessibilityLabel="녹음 중 메모" placeholder="지금 떠오른 생각을 메모하세요" value={memo} onChangeText={setMemo} editable={active && !task.busy} returnKeyType="send" onSubmitEditing={() => { void addMemo('memo'); }} />
      <View style={styles.row}>
        <Button title="메모 추가" disabled={!active || task.busy || !memo.trim()} onPress={() => { void addMemo('memo'); }} />
        <Button title="☆ 북마크" disabled={!active || task.busy} onPress={() => { void addMemo('bookmark'); }} />
        <Button title={live?.state === 'paused' ? '다시 녹음' : '일시정지'} disabled={!active || task.busy} onPress={() => { void task.run(() => live?.state === 'paused' ? pipeline.resumeRecording() : pipeline.pauseRecording()); }} />
        <Button title={live?.state === 'idle' ? '저장하고 종료' : '녹음 종료'} primary disabled={!noteId || starting || !live || live.state === 'stopping' || task.busy} onPress={() => { void stop(); }} />
        {!!noteId && !starting && !live && <Button title="저장된 노트 보기" onPress={() => router.replace({ pathname: '/note/[id]', params: { id: noteId } })} />}
      </View>
    </View>
  </KeyboardAvoidingView></Screen>;
}

import { t, useT } from '../i18n';
import { LevelMeter, RecordingStatus } from '../ui/RecordingVisuals';
import { ModelBanner } from '../ui/ModelBanner';
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
import { shadow, styles, type, useIsDark, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
const warningText = (warning: RecorderWarning) => ({ 'mic-ended': t('micDisconnected'), silence: t('silenceWarning'), 'low-storage': t('lowStorage'), interrupted: t('recordingInterrupted') })[warning.kind];
export default function RecordScreen() {
  useT();
  const c = useTheme(); const dark = useIsDark(); const task = useTask(); const navigation = useNavigation();
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
    startPromise.current.then(id => { if (alive) setNoteId(id); }).catch(error => { if (alive) { setStartError(true); if (error instanceof Error && error.message === t('recordingOtherTab')) task.setError(error.message); } }).finally(() => { if (alive) setStarting(false); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  const blocking = starting || !!live;
  usePreventRemove(Platform.OS === 'web' && blocking, ({ data }) => {
    if (finished.current) { navigation.dispatch(data.action); return; }
    void confirmAction(t('leaveRecordingPrompt'), t('leave')).then(leave => { if (leave) navigation.dispatch(data.action); });
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
    setAttached(t('memoAttached', { p0: formatTimestamp(result.atMs), p1: kind === 'bookmark' ? t('bookmark') : t('memo') }));
  }, t('memoSaveError'));
  const stop = () => task.run(async () => {
    if (!await confirmAction(t('stopRecordingPrompt'), t('stopRecording'))) return;
    await pipeline.stopRecording();
    finished.current = true;
    router.replace({ pathname: '/note/[id]', params: { id: noteId } });
  }, t('recordingStopError'));
  const active = !!noteId && !!live && (live.state === 'recording' || live.state === 'paused');
  return <Screen><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={96}>
    <View style={[styles.content, { paddingBottom: 8 }]}>
      {Platform.OS === 'web' && <Notice tone="info" text={t('webRecordingNotice')} />}
      {startError && <><Notice error text={t('recordingStartError')} />{Platform.OS !== 'web' && <Button title={t('openDeviceSettings')} onPress={() => { void task.run(() => Linking.openSettings()); }} />}<Button title={t('backToNotes')} onPress={() => router.replace('/')} /></>}
      <Text accessibilityLabel={t('recordingTime')} style={[type.display, { color: live?.state === 'paused' ? c.textMuted : c.text, textAlign: 'center', marginTop: 24 }]}>{formatTime(live?.elapsedMs ?? 0)}</Text>
      <RecordingStatus recording={!starting && active && live?.state !== 'paused'} paused={live?.state === 'paused'} text={starting ? t('micPreparing') : live?.state === 'paused' ? t('pause') : active ? t('recording') : t('recordingEnded')} />
      <LevelMeter level={live?.level ?? 0} paused={live?.state === 'paused'} />
      <Text style={[type.caption, { color: c.muted, textAlign: 'center', fontVariant: ['tabular-nums'] }]}>{t('transcriptionPending')} {live?.pendingChunks ?? 0}</Text>
      {Array.from(new Map((live?.warnings ?? []).map(w => [w.kind, w])).values()).map(w => <Notice key={w.kind} tone={w.kind === 'mic-ended' ? 'danger' : 'warning'} text={warningText(w)} />)}
    </View>
    <ScrollView ref={transcript} style={{ flex: 1 }} contentContainerStyle={styles.content} onContentSizeChange={() => transcript.current?.scrollToEnd({ animated: true })}>
      {live?.liveSegments.slice(-20).map(segment => <Text key={segment.id} style={[type.reading, { color: segment === live?.liveSegments.at(-1) ? c.text : c.textSecondary, marginBottom: 12 }]}>{segment.text}</Text>)}
      {!live?.liveSegments.length && <Text style={[type.reading, { color: c.muted }]}>{t('liveTranscriptEmpty')}</Text>}
    </ScrollView>
    <ModelBanner dock />
    <View style={[styles.content, { backgroundColor: c.surfaceRaised, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 12, gap: 10, ...shadow(dark).md }]}>
      {!!task.error && <Notice error text={task.error} />}
      {!!attached && <Text accessibilityLiveRegion="polite" style={[type.small, { color: c.accentText, fontVariant: ['tabular-nums'] }]}>{attached}</Text>}
      <Input accessibilityLabel={t('recordingMemo')} placeholder={t('memoPlaceholder')} value={memo} onChangeText={setMemo} editable={active && !task.busy} returnKeyType="send" onSubmitEditing={() => { void addMemo('memo'); }} />
      <View style={styles.row}>
        <Button title={t('addMemo')} disabled={!active || task.busy || !memo.trim()} onPress={() => { void addMemo('memo'); }} />
        <Button title={t('bookmarkButton')} disabled={!active || task.busy} onPress={() => { void addMemo('bookmark'); }} />
        <Button title={live?.state === 'paused' ? t('resumeRecording') : t('pause')} disabled={!active || task.busy} onPress={() => { void task.run(() => live?.state === 'paused' ? pipeline.resumeRecording() : pipeline.pauseRecording()); }} />
        <Button title={live?.state === 'idle' ? t('saveAndFinish') : t('stopRecording')} stop style={{ minWidth: 120, marginLeft: 'auto' }} disabled={!noteId || starting || !live || live.state === 'stopping' || task.busy} onPress={() => { void stop(); }} />
        {!!noteId && !starting && !live && <Button title={t('viewSavedNote')} primary onPress={() => router.replace({ pathname: '/note/[id]', params: { id: noteId } })} />}
      </View>
    </View>
  </KeyboardAvoidingView></Screen>;
}

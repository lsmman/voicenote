import { t, useT } from '../i18n';
import { LevelMeter, RecordingStatus } from '../ui/RecordingVisuals';
import { ModelBanner } from '../ui/ModelBanner';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Linking, Platform, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
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
  const { stopAt } = useLocalSearchParams<{ stopAt?: string }>();
  const routeStopApplied = useRef(false);
  useEffect(() => {
    if (starting || !live || live.noteId !== noteId || routeStopApplied.current) return;
    routeStopApplied.current = true;
    const at = typeof stopAt === 'string' && stopAt.trim() ? Number(stopAt) : NaN;
    if (Number.isFinite(at) && at > Date.now()) pipeline.scheduleStop(at);
  }, [starting, live, noteId, stopAt]);
  const finished = useRef(false);
  const manualStop = useRef(false);
  const [stopTime, setStopTime] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [clockNow, setClockNow] = useState(Date.now);
  useEffect(() => {
    if (live?.stopAt == null) return;
    setClockNow(Date.now());
    const timer = setInterval(() => setClockNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live?.stopAt]);
  const startPromise = useRef<Promise<string> | null>(null); const transcript = useRef<ScrollView>(null);
  useEffect(() => {
    let alive = true;
    let activeNoteId = '';
    const unsubscribe = pipeline.subscribe((state: LiveSessionState | null) => {
      if (!alive) return;
      setLive(state);
      if (state) {
        setNoteId(state.noteId);
        if (state.state === 'recording' || state.state === 'paused') activeNoteId = state.noteId;
        if (state.stopError) task.setError(t('recordingStopError'));
      } else if (activeNoteId && !manualStop.current && !finished.current) {
        finished.current = true;
        router.replace({ pathname: '/note/[id]', params: { id: activeNoteId } });
      }
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
    if (finished.current) return;
    manualStop.current = true;
    try {
      await pipeline.stopRecording();
      finished.current = true;
      router.replace({ pathname: '/note/[id]', params: { id: noteId } });
    } finally { manualStop.current = false; }
  }, t('recordingStopError'));
  const schedule = (at: number | null) => {
    setScheduleError('');
    setClockNow(Date.now());
    void task.run(async () => { pipeline.scheduleStop(at); }, t('recordingStopError'));
  };
  const scheduleTime = () => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(stopTime)) {
      setScheduleError(t('invalidStopTime')); return;
    }
    const now = Date.now();
    const target = new Date(now);
    const [hours, minutes] = stopTime.split(':').map(Number);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= now) target.setDate(target.getDate() + 1);
    schedule(target.getTime());
  };
  const deadline = live?.stopAt == null ? null : new Date(live.stopAt);
  const remainingMinutes = Math.max(0, Math.ceil(((live?.stopAt ?? clockNow) - clockNow) / 60_000));
  const active = !!noteId && !!live && (live.state === 'recording' || live.state === 'paused');
  return <Screen><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={96}>
    <View style={[styles.content, { paddingBottom: 8 }]}>
      {Platform.OS === 'web' && <Notice tone="info" text={t('webRecordingNotice')} />}
      {startError && <><Notice error text={t('recordingStartError')} />{Platform.OS !== 'web' && <Button title={t('openDeviceSettings')} onPress={() => { void task.run(() => Linking.openSettings()); }} />}<Button title={t('backToNotes')} onPress={() => router.replace('/')} /></>}
      <Text accessibilityLabel={t('recordingTime')} style={[type.display, { color: live?.state === 'paused' ? c.textMuted : c.text, textAlign: 'center', marginTop: 24 }]}>{formatTime(live?.elapsedMs ?? 0)}</Text>
      {active && <View style={{ gap: 8, marginTop: 8 }}>
        <Text style={[type.label, { color: c.textSecondary }]}>{t('scheduledStop')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[30, 60, 120, 180].map(minutes => <Button key={minutes} compact style={{ minHeight: 44 }} disabled={task.busy}
            title={minutes === 30 ? t('stopPresetMinutes') : t('stopPresetHours', { hours: minutes / 60 })}
            onPress={() => schedule(Date.now() + minutes * 60_000)} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          <Input style={{ width: 100 }} accessibilityLabel={t('stopTimeLabel')} placeholder="HH:mm" value={stopTime}
            onChangeText={setStopTime} maxLength={5} autoCorrect={false} editable={!task.busy}
            returnKeyType="done" onSubmitEditing={scheduleTime} />
          <Button compact style={{ minHeight: 44 }} title={t('setStopTime')} disabled={task.busy} onPress={scheduleTime} />
          {deadline && <Button compact style={{ minHeight: 44 }} title={t('cancelStopTime')} disabled={task.busy} onPress={() => schedule(null)} />}
        </View>
        {!!scheduleError && <Notice error text={scheduleError} />}
        {deadline && <Text style={[type.small, { color: c.textSecondary }]}>{t('scheduledStopStatus', {
          time: `${String(deadline.getHours()).padStart(2, '0')}:${String(deadline.getMinutes()).padStart(2, '0')}`,
          hours: Math.floor(remainingMinutes / 60), minutes: remainingMinutes % 60,
        })}</Text>}
      </View>}
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

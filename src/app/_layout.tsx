import { useEffect, useRef, useState } from 'react';
import { AppState, ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import { pipeline, store } from '../services';
import { handleAuthRedirect } from '../sync/auth';
import { confirmAction } from '../ui/actions';
import { Button, Notice } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';

export default function RootLayout() {
  const c = useTheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const startup = useRef<Promise<void> | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!startup.current) startup.current = (async () => {
      await store.init();
      // Queue resumption failure must not hide local notes or recording.
      void pipeline.resumeQueues().catch(() => { if (alive) setError('대기 작업을 재개하지 못했어요. 앱을 다시 열면 재시도해요.'); });
      const unfinished = await pipeline.findUnfinished();
      if (unfinished.length && await confirmAction('중단된 녹음이 있어요. 저장된 부분까지 복구할까요?', '복구')) {
        for (const note of unfinished) await pipeline.recover(note.id);
      }
    })();
    startup.current.then(() => { if (alive) setReady(true); }).catch(() => { if (alive) setError('저장된 노트를 준비하지 못했어요. 다시 시도해 주세요.'); });
    return () => { alive = false; };
  }, [retry]);
  useEffect(() => {
    const seen = new Set<string>();
    const redirect = async (url: string | null) => {
      if (!url || seen.has(url) || !/[?#&](code|access_token|error|error_description)=/.test(url)) return;
      seen.add(url);
      try { await handleAuthRedirect(url); }
      catch { seen.delete(url); setError('로그인 링크를 확인하지 못했어요. 새 링크로 다시 시도해 주세요.'); }
    };
    void Linking.getInitialURL().then(redirect).catch(() => setError('로그인 링크를 열지 못했어요.'));
    const links = Linking.addEventListener('url', ({ url }) => { void redirect(url); });
    const state = AppState.addEventListener('change', value => {
      if (value === 'active') void pipeline.resumeQueues().catch(() => setError('대기 작업을 재개하지 못했어요. 연결 상태를 확인해 주세요.'));
    });
    return () => { links.remove(); state.remove(); };
  }, []);
  return <View style={[styles.screen, { backgroundColor: c.background }]}>
    {!!error && <View style={{ padding: 16 }}><Notice text={error} error /><Button title={ready ? '닫기' : '다시 시도'} onPress={() => { setError(''); if (!ready) { startup.current = null; setRetry(n => n + 1); } }} /></View>}
    {!ready ? <ActivityIndicator accessibilityLabel="노트 준비 중" style={{ margin: 40 }} color={c.accent} /> : <Stack screenOptions={{ headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, contentStyle: { backgroundColor: c.background }, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: '음성 노트' }} />
      <Stack.Screen name="record" options={{ title: '녹음', gestureEnabled: false, headerBackVisible: false }} />
      <Stack.Screen name="note/[id]" options={{ title: '노트' }} />
      <Stack.Screen name="settings" options={{ title: '설정' }} />
      <Stack.Screen name="login" options={{ title: '로그인' }} />
    </Stack>}
  </View>;
}

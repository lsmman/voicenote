import { t, useT } from '../i18n';
import { loadLanguage, useLanguage } from '../i18n/language';
import { useEffect, useRef, useState } from 'react';
import { AppState, ActivityIndicator, Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import * as Linking from 'expo-linking';
import { pipeline, store } from '../services';
import { supabase } from '../sync';
import { handleAuthRedirect } from '../sync/auth';
import { loadScheduledStart, startScheduledStartWatcher } from '../ui/scheduledStart';
import { webLocks } from '../ui/recordingSession';
import { recoverUnfinished, type RecoveryChoice } from '../ui/recovery';
import { Button, Notice } from '../ui/primitives';
import { fontSans, styles, useTheme } from '../ui/theme';

if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('font-pretendard')) {
  const link = document.createElement('link');
  link.id = 'font-pretendard'; link.rel = 'stylesheet';
  link.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css';
  document.head.appendChild(link);
  const style = document.createElement('style');
  style.textContent = `
    body, body * { font-family: ${fontSans} !important; }
    body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
    ::selection { background: rgba(62,99,221,0.22); }
    [role="button"]:focus-visible, [role="tab"]:focus-visible, a:focus-visible { outline: 2px solid var(--vn-focus); outline-offset: 2px; }
    @media (prefers-color-scheme: dark) { ::selection { background: rgba(110,139,255,0.35); } }
  `;
  document.head.appendChild(style);
}

const promptedNotes = new Set<string>();

export default function RootLayout() {
  useT();
  const language = useLanguage();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = language;
  }, [language]);
  const c = useTheme();
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.body.style.backgroundColor = c.bg;
      document.body.style.setProperty('--vn-focus', c.focusRing);
    }
  }, [c.bg, c.focusRing]);
  const [recovery, setRecovery] = useState<{ title: string; resolve: (choice: RecoveryChoice) => void } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const startup = useRef<Promise<void> | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!startup.current) startup.current = (async () => {
      await loadLanguage();
      await loadScheduledStart();
      await store.init();
      // Queue resumption failure must not hide local notes or recording.
      void pipeline.resumeQueues().catch(() => { if (alive) setError(t('resumeStartupError')); });
      await recoverUnfinished({
        pipeline, store, web: Platform.OS === 'web', locks: webLocks(Platform.OS === 'web'), seen: promptedNotes,
        choose: note => new Promise<RecoveryChoice>(resolve => setRecovery({ title: note.title, resolve: choice => { setRecovery(null); resolve(choice); } })),
        onError: () => { if (alive) setError(t('recoverError')); },
      });
    })();
    startup.current.then(() => { if (alive) setReady(true); }).catch(() => { if (alive) setError(t('prepareNotesError')); });
    return () => { alive = false; };
  }, [retry]);
  useEffect(() => {
    if (ready) return startScheduledStartWatcher(pipeline);
  }, [ready]);
  useEffect(() => {
    const seen = new Set<string>();
    const redirect = async (url: string | null) => {
      if (!url || seen.has(url) || !/[?#&](code|access_token|error|error_description)=/.test(url)) return;
      seen.add(url);
      try { await handleAuthRedirect(url); }
      catch { seen.delete(url); setError(t('loginLinkError')); }
    };
    void Linking.getInitialURL().then(redirect).catch(() => setError(t('loginLinkOpenError')));
    const links = Linking.addEventListener('url', ({ url }) => { void redirect(url); });
    const state = AppState.addEventListener('change', value => {
      if (value === 'active') void pipeline.resumeQueues().catch(() => setError(t('resumeConnectionError')));
    });
    // Mirror local notes after sign-in and periodically while signed in (edits, memos, summaries).
    const resume = () => { void pipeline.resumeQueues().catch(() => undefined); };
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN') resume(); });
    const timer = setInterval(() => { void supabase.auth.getSession().then(({ data }) => { if (data.session) resume(); }).catch(() => undefined); }, 60_000);
    return () => { links.remove(); state.remove(); subscription.unsubscribe(); clearInterval(timer); };
  }, []);
  return <View style={[styles.screen, { backgroundColor: c.background }]}>
    {recovery && <View style={styles.content}><Text style={[styles.heading, { color: c.text }]}>{recovery.title || t('interruptedRecording')}</Text><Notice text={t('recoverPrompt')} /><View style={styles.row}><Button title={t('recover')} onPress={() => recovery.resolve('recover')} /><Button title={t('remove')} danger onPress={() => recovery.resolve('discard')} /><Button title={t('later')} onPress={() => recovery.resolve('later')} /></View></View>}
    {!!error && <View style={{ padding: 16 }}><Notice text={error} error /><Button title={ready ? t('close') : t('retry')} onPress={() => { setError(''); if (!ready) { startup.current = null; setRetry(n => n + 1); } }} /></View>}
    {!ready ? <ActivityIndicator accessibilityLabel={t('loadingNotes')} style={{ margin: 40 }} color={c.textMuted} /> : <Stack screenOptions={{ headerStyle: { backgroundColor: c.bg }, headerTitleStyle: { fontSize: 17, fontWeight: '600' }, headerTintColor: c.text, contentStyle: { backgroundColor: c.background }, headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: t('appName') }} />
      <Stack.Screen name="record" options={{ title: t('record'), gestureEnabled: false, headerBackVisible: false }} />
      <Stack.Screen name="note/[id]" options={{ title: t('note') }} />
      <Stack.Screen name="settings" options={{ title: t('settings') }} />
      <Stack.Screen name="login" options={{ title: t('login') }} />
    </Stack>}
  </View>;
}

import { t, useT } from '../i18n';
import { LANGUAGES, setLanguage, useLanguage } from '../i18n/language';
import { useModelState } from '../ui/useModelState';
import { ModelBanner } from '../ui/ModelBanner';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { engine, pipeline } from '../services';
import { getModelId, setModelId } from '../core/settings';
import { signOut } from '../sync/auth';
import { isSyncConfigured } from '../sync';
import { useSession } from '../ui/useSession';
import type { ModelInfo, ModelDownloadProgress } from '../transcriber/types';
import { Button, Notice, Screen } from '../ui/primitives';
import { styles, type, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
import { confirmAction } from '../ui/actions';
import ApiTokens from '../components/ApiTokens';
export default function SettingsScreen() {
  useT();
  const language = useLanguage();
  const c = useTheme(); const task = useTask(); const { session, loading } = useSession();
  const [models, setModels] = useState<ModelInfo[]>([]); const [ready, setReady] = useState<Record<string, boolean>>({}); const [selected, setSelected] = useState('');
  const modelState = useModelState();
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  useEffect(() => { void task.run(async () => {
    const list = engine.listModels(); setModels(list); setSelected(await getModelId());
    setReady(Object.fromEntries(await Promise.all(list.map(async model => [model.id, await engine.isModelReady(model.id)]))));
  }, t('modelLoadError')); }, [task.run]);
  useEffect(() => { if (modelState?.kind === 'ready' && modelState.modelId) setReady(old => ({ ...old, [modelState.modelId]: true })); }, [modelState]);
  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Text style={[styles.title, { color: c.text }]}>{t('settingsTitle')}</Text>
    <Text style={[styles.heading, { color: c.text }]}>{t('language')}</Text>
    <View style={styles.row}>{LANGUAGES.map(value => <Button key={value} title={{ ko: '한국어', en: 'English', zh: '中文' }[value]} primary={language === value} disabled={language === value} onPress={() => { void setLanguage(value); }} />)}</View>
    <Text style={[styles.heading, { color: c.text }]}>{t('transcriptionModel')}</Text>
    <Text style={[styles.body, { color: c.textSecondary }]}>{t('modelDescription')}</Text>
    {!!task.error && <Notice error text={task.error} />}
    <ModelBanner />
    {models.map(model => {
      const sharedProgress = modelState?.kind === 'downloading' && modelState.modelId === model.id ? modelState.progress : null;
      const downloading = sharedProgress !== null || progress?.modelId === model.id;
      const percent = sharedProgress !== null ? Math.round(sharedProgress * 100) : progress?.modelId === model.id && progress.totalBytes > 0 ? Math.min(100, Math.round(progress.receivedBytes / progress.totalBytes * 100)) : 0;
      return <View key={model.id} style={[styles.card, { backgroundColor: c.surface, borderColor: selected === model.id ? c.accent : c.border, borderWidth: selected === model.id ? 1.5 : 1 }]}>
        <Text style={[styles.heading, { color: c.text }]}>{model.label}<Text style={[type.caption, { color: c.accentText, backgroundColor: c.accentSoft }]}>{model.recommended ? t('recommendedSuffix') : ''}</Text></Text>
        <Text style={[styles.small, { color: c.muted, fontVariant: ['tabular-nums'] }]}>{Math.round(model.sizeBytes / 1024 / 1024)} MB · {ready[model.id] ? t('ready') : t('downloadRequired')}{selected === model.id ? t('selectedSuffix') : ''}</Text>
        {downloading && <><View accessibilityRole="progressbar" accessibilityLabel={t('modelDownload')} accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 4, backgroundColor: c.subtle, borderRadius: 2 }}><View style={{ width: `${percent}%`, height: 4, backgroundColor: c.accent }} /></View><Text style={[type.caption, { color: c.muted, fontVariant: ['tabular-nums'] }]}>{percent}%</Text></>}
        <View style={styles.row}>
          <Button compact title={selected === model.id ? t('selected') : t('select')} disabled={task.busy || modelState?.kind === 'downloading' || selected === model.id} onPress={() => { void task.run(async () => { await setModelId(model.id); setSelected(model.id); }); }} />
          {ready[model.id] ? <Button compact title={t('remove')} danger disabled={task.busy || modelState?.kind === 'downloading'} onPress={() => { void task.run(async () => {
            if (!await confirmAction(t('modelDeletePrompt'), t('remove'))) return;
            await engine.deleteModel(model.id); setReady(old => ({ ...old, [model.id]: false }));
          }, t('modelDeleteError')); }} /> : <Button compact title={t('download')} primary disabled={task.busy || modelState?.kind === 'downloading'} onPress={() => { void task.run(async () => {
            if (selected === model.id) { await pipeline.downloadModelNow(); return; }
            setProgress({ modelId: model.id, receivedBytes: 0, totalBytes: model.sizeBytes });
            try { await engine.downloadModel(model.id, setProgress); const installed = await engine.isModelReady(model.id); setReady(old => ({ ...old, [model.id]: installed })); if (!installed) throw new Error('not ready'); }
            finally { setProgress(null); }
          }, t('modelDownloadError')); }} />}
        </View>
      </View>;
    })}
    <Text style={[styles.heading, { color: c.text }]}>{t('account')}</Text>
    {!isSyncConfigured ? <Notice text={t('localOnly')} /> : loading ? <Notice text={t('checkingAccount')} /> : session ? <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}><Text style={[styles.body, { color: c.text }]}>{session.user.email}</Text><Button compact title={t('signOut')} disabled={task.busy} onPress={() => { void task.run(() => signOut(), t('signOutError')); }} /></View> : <Button compact title={t('signInEmail')} onPress={() => router.push('/login')} />}
    {isSyncConfigured && session && <ApiTokens />}
  </ScrollView></Screen>;
}

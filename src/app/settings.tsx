import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { engine } from '../services';
import { getModelId, setModelId } from '../core/settings';
import { signOut } from '../sync/auth';
import { useSession } from '../ui/useSession';
import type { ModelInfo, ModelDownloadProgress } from '../transcriber/types';
import { Button, Notice, Screen } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { useTask } from '../ui/useTask';
import { confirmAction } from '../ui/actions';
export default function SettingsScreen() {
  const c = useTheme(); const task = useTask(); const { session, loading } = useSession();
  const [models, setModels] = useState<ModelInfo[]>([]); const [ready, setReady] = useState<Record<string, boolean>>({}); const [selected, setSelected] = useState('');
  const [progress, setProgress] = useState<ModelDownloadProgress | null>(null);
  useEffect(() => { void task.run(async () => {
    const list = engine.listModels(); setModels(list); setSelected(await getModelId());
    setReady(Object.fromEntries(await Promise.all(list.map(async model => [model.id, await engine.isModelReady(model.id)]))));
  }, '모델 정보를 불러오지 못했어요. 설정을 다시 열어 주세요.'); }, [task.run]);
  return <Screen><ScrollView contentContainerStyle={styles.content}>
    <Text style={[styles.title, { color: c.text }]}>내 기기에 맞게</Text>
    <Text style={[styles.heading, { color: c.text }]}>전사 모델</Text>
    <Text style={[styles.body, { color: c.muted }]}>모델은 기기에 저장돼요. 다운로드가 끝나기 전에도 녹음할 수 있어요.</Text>
    {!!task.error && <Notice error text={task.error} />}
    {models.map(model => {
      const downloading = progress?.modelId === model.id;
      const percent = downloading && progress.totalBytes > 0 ? Math.min(100, Math.round(progress.receivedBytes / progress.totalBytes * 100)) : 0;
      return <View key={model.id} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Text style={[styles.heading, { color: c.text }]}>{model.label}{model.recommended ? ' · 추천' : ''}</Text>
        <Text style={[styles.small, { color: c.muted }]}>{Math.round(model.sizeBytes / 1024 / 1024)} MB · {ready[model.id] ? '준비 완료' : '다운로드 필요'}{selected === model.id ? ' · 선택됨' : ''}</Text>
        {downloading && <><View accessibilityRole="progressbar" accessibilityLabel="모델 다운로드" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 8, backgroundColor: c.border, borderRadius: 4 }}><View style={{ width: `${percent}%`, height: 8, backgroundColor: c.accent }} /></View><Text style={{ color: c.muted }}>{percent}%</Text></>}
        <View style={styles.row}>
          <Button title={selected === model.id ? '선택됨' : '선택'} disabled={task.busy || selected === model.id} onPress={() => { void task.run(async () => { await setModelId(model.id); setSelected(model.id); }); }} />
          {ready[model.id] ? <Button title="삭제" danger disabled={task.busy} onPress={() => { void task.run(async () => {
            if (!await confirmAction('모델을 삭제할까요? 다음 전사 전에 다시 다운로드해야 해요.', '삭제')) return;
            await engine.deleteModel(model.id); setReady(old => ({ ...old, [model.id]: false }));
          }, '모델을 삭제하지 못했어요. 전사가 끝난 뒤 다시 시도해 주세요.'); }} /> : <Button title="다운로드" primary disabled={task.busy} onPress={() => { void task.run(async () => {
            setProgress({ modelId: model.id, receivedBytes: 0, totalBytes: model.sizeBytes });
            try { await engine.downloadModel(model.id, setProgress); const installed = await engine.isModelReady(model.id); setReady(old => ({ ...old, [model.id]: installed })); if (!installed) throw new Error('not ready'); }
            finally { setProgress(null); }
          }, '모델 다운로드에 실패했어요. 다운로드 버튼을 눌러 다시 시도해 주세요. 녹음은 계속 사용할 수 있어요.'); }} />}
        </View>
      </View>;
    })}
    <Text style={[styles.heading, { color: c.text }]}>계정</Text>
    {loading ? <Notice text="계정 확인 중…" /> : session ? <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}><Text style={[styles.body, { color: c.text }]}>{session.user.email}</Text><Button title="로그아웃" disabled={task.busy} onPress={() => { void task.run(() => signOut(), '로그아웃하지 못했어요. 다시 시도해 주세요.'); }} /></View> : <Button title="이메일로 로그인" onPress={() => router.push('/login')} />}
  </ScrollView></Screen>;
}

import { Text, View } from 'react-native';
import { pipeline } from '../services';
import { useModelState } from './useModelState';
import { Button } from './primitives';
import { styles, useTheme } from './theme';

export function ModelBanner({ dock = false }: { dock?: boolean }) {
  const state = useModelState();
  const c = useTheme();
  if (!state || state.kind === 'ready') return null;
  const percent = state.kind === 'downloading' ? Math.round(state.progress * 100) : 0;
  return <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: dock ? c.subtle : c.surface, borderColor: c.border, borderWidth: dock ? 0 : 1 }]}>
    <Text style={[styles.body, { fontVariant: ['tabular-nums'], color: state.kind === 'error' ? c.danger : c.text }]}>{state.kind === 'downloading' ? `전사 모델 받는 중 ${percent}%` : state.kind === 'waiting-wifi' ? `Wi-Fi에 연결되면 전사 모델(${Math.round(state.sizeBytes / 1024 / 1024)} MB)을 받아요` : state.message}</Text>
    {state.kind === 'downloading' ? <View accessibilityRole="progressbar" accessibilityLabel="전사 모델 다운로드" accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 4, backgroundColor: c.subtle, borderRadius: 2, overflow: 'hidden' }}><View style={{ width: `${percent}%`, height: 4, backgroundColor: c.accent }} /></View> : <Button compact style={{ alignSelf: 'flex-start' }} title={state.kind === 'error' ? '다시 시도' : '지금 받기'} onPress={() => { void pipeline.downloadModelNow(); }} />}
  </View>;
}

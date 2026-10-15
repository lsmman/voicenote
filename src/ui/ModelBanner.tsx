import { t, useT } from '../i18n';
import { Text, View } from 'react-native';
import { pipeline } from '../services';
import { useModelState } from './useModelState';
import { Button } from './primitives';
import { styles, useTheme } from './theme';

export function ModelBanner({ dock = false }: { dock?: boolean }) {
  const state = useModelState();
  useT();
  const c = useTheme();
  if (!state || state.kind === 'ready') return null;
  const percent = state.kind === 'downloading' ? Math.round(state.progress * 100) : 0;
  return <View accessibilityLiveRegion="polite" style={[styles.card, { backgroundColor: dock ? c.subtle : c.surface, borderColor: c.border, borderWidth: dock ? 0 : 1 }]}>
    <Text style={[styles.body, { fontVariant: ['tabular-nums'], color: state.kind === 'error' ? c.danger : c.text }]}>{state.kind === 'downloading' ? t('modelProgress', { p0: percent }) : state.kind === 'waiting-wifi' ? t('modelWifi', { p0: Math.round(state.sizeBytes / 1024 / 1024) }) : t('modelRetryError')}</Text>
    {state.kind === 'downloading' ? <View accessibilityRole="progressbar" accessibilityLabel={t('transcriptionModelDownload')} accessibilityValue={{ min: 0, max: 100, now: percent }} style={{ height: 4, backgroundColor: c.subtle, borderRadius: 2, overflow: 'hidden' }}><View style={{ width: `${percent}%`, height: 4, backgroundColor: c.accent }} /></View> : <Button compact style={{ alignSelf: 'flex-start' }} title={state.kind === 'error' ? t('retry') : t('downloadNow')} onPress={() => { void pipeline.downloadModelNow(); }} />}
  </View>;
}

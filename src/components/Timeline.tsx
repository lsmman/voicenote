import { t, useT } from '../i18n';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Memo } from '../core/types';
import { formatTimestamp } from '../ui/format';
import { shadow, type, useIsDark, useTheme } from '../ui/theme';
export function Timeline({ durationMs, positionMs, memos, onSeek }: { durationMs: number; positionMs: number; memos: Memo[]; onSeek: (ms: number) => void }) {
  useT();
  const c = useTheme(); const dark = useIsDark(); const [width, setWidth] = useState(1);
  const [scrub, setScrub] = useState<number | null>(null);
  const displayed = scrub ?? positionMs;
  const at = (x: number) => Math.max(0, Math.min(durationMs, x / Math.max(1, width) * durationMs));
  const ratio = (ms: number) => durationMs > 0 ? Math.max(0, Math.min(1, ms / durationMs)) : 0;
  return <View>
    <View accessibilityRole="adjustable" accessibilityLabel={t('playbackPosition')} accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(displayed / 1000), text: formatTimestamp(displayed) }} accessibilityActions={[{ name: 'increment', label: t('seekForward') }, { name: 'decrement', label: t('seekBack') }]} onAccessibilityAction={event => onSeek(Math.min(durationMs, Math.max(0, positionMs + (event.nativeEvent.actionName === 'increment' ? 10000 : -10000))))}
      onLayout={event => setWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => durationMs > 0} onMoveShouldSetResponder={() => durationMs > 0} onResponderGrant={event => setScrub(at(event.nativeEvent.locationX))} onResponderMove={event => setScrub(at(event.nativeEvent.locationX))} onResponderRelease={event => { onSeek(at(event.nativeEvent.locationX)); setScrub(null); }} onResponderTerminate={() => setScrub(null)} style={{ height: 48, justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ height: 4, backgroundColor: c.borderStrong, borderRadius: 2 }}><View style={{ width: `${ratio(displayed) * 100}%`, height: 4, backgroundColor: c.accent, borderRadius: 2 }} /></View>
      {memos.map(m => <View pointerEvents="none" key={m.id} style={{ position: 'absolute', left: `${ratio(m.atMs) * 100}%`, marginLeft: m.kind === 'bookmark' ? -4 : -1, width: m.kind === 'bookmark' ? 8 : 2, height: m.kind === 'bookmark' ? 8 : 10, borderRadius: m.kind === 'bookmark' ? 4 : 1, borderWidth: m.kind === 'bookmark' ? 1.5 : 0, borderColor: c.surface, backgroundColor: m.kind === 'bookmark' ? c.bookmark : c.textMuted }} />)}
      <View pointerEvents="none" style={{ position: 'absolute', left: `${ratio(displayed) * 100}%`, width: scrub !== null ? 18 : 14, height: scrub !== null ? 18 : 14, marginLeft: scrub !== null ? -9 : -7, borderRadius: 9, borderWidth: 2, borderColor: c.accent, backgroundColor: c.surfaceRaised, ...shadow(dark).sm }} />
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 }}><Text style={[type.caption, { color: c.muted, fontVariant: ['tabular-nums'] }]}>{formatTimestamp(displayed)}</Text><Text style={[type.caption, { color: c.muted, fontVariant: ['tabular-nums'] }]}>{formatTimestamp(durationMs)}</Text></View>
    {!!memos.length && <ScrollView horizontal style={{ maxHeight: 48 }} contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>{memos.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.kind === 'bookmark' ? t('bookmark') : t('memo')} ${formatTimestamp(m.atMs)} ${m.text}`} onPress={() => onSeek(m.atMs)} hitSlop={{ top: 8, bottom: 8 }} style={{ height: 28, minWidth: 48, paddingHorizontal: 10, borderRadius: 999, backgroundColor: c.subtle, justifyContent: 'center' }}><Text style={[type.caption, { color: c.textSecondary, fontVariant: ['tabular-nums'] }]}><Text style={{ color: m.kind === 'bookmark' ? c.bookmark : c.accent }}>{m.kind === 'bookmark' ? '★' : '●'}</Text> {formatTimestamp(m.atMs)}</Text></Pressable>)}</ScrollView>}
  </View>;
}

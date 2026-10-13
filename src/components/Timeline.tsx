import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Memo } from '../core/types';
import { formatTimestamp } from '../ui/format';
import { styles, useTheme } from '../ui/theme';
export function Timeline({ durationMs, positionMs, memos, onSeek }: { durationMs: number; positionMs: number; memos: Memo[]; onSeek: (ms: number) => void }) {
  const c = useTheme(); const [width, setWidth] = useState(1);
  const ratio = (ms: number) => durationMs > 0 ? Math.max(0, Math.min(1, ms / durationMs)) : 0;
  return <View>
    <View accessibilityRole="adjustable" accessibilityLabel="재생 위치" accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(positionMs / 1000), text: formatTimestamp(positionMs) }} accessibilityActions={[{ name: 'increment', label: '10초 앞으로' }, { name: 'decrement', label: '10초 뒤로' }]} onAccessibilityAction={event => onSeek(Math.min(durationMs, Math.max(0, positionMs + (event.nativeEvent.actionName === 'increment' ? 10000 : -10000))))}
      onLayout={event => setWidth(event.nativeEvent.layout.width)} onStartShouldSetResponder={() => durationMs > 0} onMoveShouldSetResponder={() => durationMs > 0} onResponderGrant={event => onSeek(ratio(event.nativeEvent.locationX / width * durationMs) * durationMs)} onResponderMove={event => onSeek(ratio(event.nativeEvent.locationX / width * durationMs) * durationMs)} style={{ height: 48, justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ height: 6, backgroundColor: c.border, borderRadius: 3 }}><View style={{ width: `${ratio(positionMs) * 100}%`, height: 6, backgroundColor: c.accent, borderRadius: 3 }} /></View>
      {memos.map(m => <View pointerEvents="none" key={m.id} style={{ position: 'absolute', left: `${ratio(m.atMs) * 100}%`, marginLeft: -2, width: 4, height: m.kind === 'bookmark' ? 20 : 12, borderRadius: 2, backgroundColor: m.kind === 'bookmark' ? c.danger : c.accent }} />)}
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={[styles.small, { color: c.muted }]}>{formatTimestamp(positionMs)}</Text><Text style={[styles.small, { color: c.muted }]}>{formatTimestamp(durationMs)}</Text></View>
    {!!memos.length && <ScrollView horizontal style={{ maxHeight: 48 }} contentContainerStyle={{ gap: 16 }}>{memos.map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.kind === 'bookmark' ? '북마크' : '메모'} ${formatTimestamp(m.atMs)} ${m.text}`} onPress={() => onSeek(m.atMs)} style={{ minHeight: 48, minWidth: 48, justifyContent: 'center' }}><Text style={{ color: c.accent }}>{m.kind === 'bookmark' ? '★' : '●'} {formatTimestamp(m.atMs)}</Text></Pressable>)}</ScrollView>}
  </View>;
}

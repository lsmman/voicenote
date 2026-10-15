import { t, useT } from '../i18n';
import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Segment } from '../core/types';
import { Button } from '../ui/primitives';
import { formatTimestamp } from '../ui/format';
import { type, useTheme } from '../ui/theme';
export const SegmentRow = memo(function SegmentRow({ item, active, onSeek, onEdit }: {
  item: Segment; active: boolean; onSeek: (ms: number) => void; onEdit: (segment: Segment) => void;
}) {
  useT();
  const c = useTheme();
  return <View style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, marginHorizontal: -12, gap: 4, backgroundColor: active ? c.accentSoft : 'transparent' }}>
    {active && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, backgroundColor: c.accent }} />}
    <Pressable accessibilityRole="button" accessibilityLabel={`${formatTimestamp(item.startMs)} ${item.speakerLabel ?? ''} ${item.text}`} onPress={() => onSeek(item.startMs)} onLongPress={() => onEdit(item)} style={({ pressed }) => ({ minHeight: 48, flexDirection: 'row', gap: 12, borderRadius: 10, backgroundColor: pressed ? c.subtle : 'transparent' })}>
      <Text style={[type.caption, { width: 52, paddingTop: 5, color: active ? c.accentText : c.textMuted, fontWeight: active ? '600' : '500', fontVariant: ['tabular-nums'] }]}>[{formatTimestamp(item.startMs)}]</Text>
      <View style={{ flex: 1, gap: 4 }}>
        {(item.speakerLabel || item.edited) && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {!!item.speakerLabel && <Text style={[type.caption, { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.subtle, color: c.textSecondary }]}>({item.speakerLabel})</Text>}
          {item.edited && <Text style={[type.caption, { color: c.textMuted }]}> {t('edited')}</Text>}
        </View>}
        <Text style={[type.reading, { color: c.text }]}>{item.text}</Text>
      </View>
    </Pressable><Button title={t('editSentence')} ghost compact style={{ alignSelf: 'flex-end', marginTop: -2 }} onPress={() => onEdit(item)} />
  </View>;
});

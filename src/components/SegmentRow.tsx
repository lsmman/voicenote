import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Segment } from '../core/types';
import { Button } from '../ui/primitives';
import { formatTimestamp } from '../ui/format';
import { styles, useTheme } from '../ui/theme';
export const SegmentRow = memo(function SegmentRow({ item, active, onSeek, onEdit }: {
  item: Segment; active: boolean; onSeek: (ms: number) => void; onEdit: (segment: Segment) => void;
}) {
  const c = useTheme();
  return <View style={[styles.card, { borderColor: active ? c.accent : c.border, backgroundColor: active ? c.soft : c.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${formatTimestamp(item.startMs)} ${item.speakerLabel ?? ''} ${item.text}`} onPress={() => onSeek(item.startMs)} onLongPress={() => onEdit(item)} style={{ minHeight: 48 }}>
      <Text style={[styles.small, { color: c.accent }]}>[{formatTimestamp(item.startMs)}] {item.speakerLabel ? `(${item.speakerLabel})` : ''}{item.edited ? ' · 수정됨' : ''}</Text>
      <Text style={[styles.body, { color: c.text }]}>{item.text}</Text>
    </Pressable><Button title="문장 편집" onPress={() => onEdit(item)} />
  </View>;
});

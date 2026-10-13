import { Text, View } from 'react-native';
import { type, useTheme } from './theme';

export function StatusBadge({ status, text }: { status: string; text: string }) {
  const c = useTheme();
  const [background, foreground, dot] = status === 'recording' ? [c.recordingSoft, c.danger, c.recording]
    : status === 'error' ? [c.dangerSoft, c.danger, c.danger]
    : status === 'transcribing' || status === 'summarizing' ? [c.accentSoft, c.accentText, c.accent]
    : [c.subtle, c.textSecondary, status === 'done' ? c.success : c.textMuted];
  return <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 22, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: background }}>
    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
    <Text style={[type.caption, { color: foreground, fontVariant: ['tabular-nums'] }]}>{text}</Text>
  </View>;
}

import { useState, type PropsWithChildren, type ReactNode } from 'react';
import { Platform, Pressable, Text, TextInput, View, type StyleProp, type ViewStyle, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles, type, useTheme } from './theme';
export function Screen({ children }: PropsWithChildren) {
  const c = useTheme();
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: c.background }]}>{children}</SafeAreaView>;
}
export function Button({ title, onPress, disabled, primary, danger, ghost, ink, compact, stop, recordDot, leading, style }: {
  title: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean;
  ghost?: boolean; ink?: boolean; compact?: boolean; stop?: boolean; recordDot?: boolean; leading?: ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const c = useTheme(); const [hovered, setHovered] = useState(false);
  return <Pressable onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} hitSlop={compact ? 6 : undefined}
    style={({ pressed }) => [{ minHeight: compact ? 32 : 44, paddingHorizontal: compact ? 10 : 16, paddingVertical: compact ? 6 : 10, borderRadius: compact ? 8 : 10, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center',
      borderWidth: primary || ink || ghost || stop ? 0 : 1, borderColor: c.borderStrong,
      backgroundColor: stop ? c.recordingStrong : ink ? c.ink : primary ? (pressed || hovered) && !disabled ? c.accentPressed : c.accent : (pressed || hovered) && !disabled ? danger ? c.dangerSoft : c.subtle : ghost ? 'transparent' : c.surface,
      opacity: disabled ? 0.4 : ink && pressed ? 0.9 : 1, transform: [{ scale: pressed && !disabled && (primary || ink) ? 0.98 : 1 }],
    }, style]}>
    {stop ? <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c.accentContrast }} /> : recordDot ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.recording }} /> : leading}
    <Text style={[type.label, { color: stop || primary ? c.onAccent : ink ? c.inkContrast : danger ? c.danger : ghost ? c.textSecondary : c.text, fontSize: compact ? 13 : ghost ? 14 : 15, fontWeight: primary || ink || stop ? '600' : '500', fontVariant: ['tabular-nums'] }]}>{recordDot ? title.replace(/^●\s*/, '') : title.startsWith('☆') ? <><Text style={{ color: c.bookmark }}>☆</Text>{title.slice(1)}</> : title}</Text>
  </Pressable>;
}
export function Input({ variant, ...props }: TextInputProps & { variant?: 'search' | 'title' }) {
  const c = useTheme(); const [focused, setFocused] = useState(false);
  return <TextInput placeholderTextColor={c.muted} {...props}
    onFocus={event => { setFocused(true); props.onFocus?.(event); }} onBlur={event => { setFocused(false); props.onBlur?.(event); }}
    style={[styles.input, { backgroundColor: variant === 'search' && !focused ? c.subtle : c.surface, color: c.text, borderColor: focused ? c.accent : variant === 'search' ? 'transparent' : c.borderStrong },
      Platform.OS === 'web' && { outlineWidth: 0, boxShadow: focused ? `0 0 0 3px ${c.focusRing}` : 'none' },
      variant === 'title' && { ...type.title, backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 1, borderColor: focused ? c.borderStrong : 'transparent', paddingHorizontal: 0, boxShadow: 'none' }, props.style]} />;
}
export function Notice({ text, error = false, tone = 'neutral', empty = false }: { text: string; error?: boolean; tone?: 'neutral' | 'info' | 'warning' | 'danger'; empty?: boolean }) {
  const c = useTheme(); const kind = error ? 'danger' : tone;
  const colors = {
    neutral: { background: c.subtle, border: 'transparent', text: c.textSecondary, dot: null },
    info: { background: c.accentSoft, border: 'transparent', text: c.text, dot: c.accent },
    warning: { background: c.warningSoft, border: c.warningBorder, text: c.warning, dot: c.bookmark },
    danger: { background: c.dangerSoft, border: c.dangerBorder, text: c.danger, dot: c.danger },
  }[kind];
  return <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 14, paddingVertical: empty ? 32 : 12, borderRadius: 10, borderWidth: kind === 'warning' || kind === 'danger' ? 1 : 0, borderColor: colors.border, backgroundColor: colors.background }}>
    {colors.dot && <View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 7, backgroundColor: colors.dot }} />}
    <Text style={[styles.body, { flex: 1, lineHeight: 22, color: colors.text, textAlign: empty ? 'center' : 'auto', fontVariant: ['tabular-nums'] }]}>{text}</Text>
  </View>;
}

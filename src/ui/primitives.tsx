import type { PropsWithChildren } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { styles, useTheme } from './theme';
export function Screen({ children }: PropsWithChildren) {
  const c = useTheme();
  return <SafeAreaView edges={['bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: c.background }]}>{children}</SafeAreaView>;
}
export function Button({ title, onPress, disabled, primary, danger }: { title: string; onPress: () => void; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  const c = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: primary ? c.accent : c.soft, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 })}><Text style={{ color: primary ? c.onAccent : danger ? c.danger : c.text, fontSize: 16, fontWeight: '600' }}>{title}</Text></Pressable>;
}
export function Input(props: TextInputProps) {
  const c = useTheme();
  return <TextInput placeholderTextColor={c.muted} {...props} style={[styles.input, { backgroundColor: c.surface, color: c.text, borderColor: c.border }, props.style]} />;
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  const c = useTheme();
  return <View accessibilityLiveRegion="polite" style={{ padding: 14, borderRadius: 12, backgroundColor: error ? c.warning : c.soft }}><Text style={[styles.body, { color: error ? c.danger : c.text }]}>{text}</Text></View>;
}

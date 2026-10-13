import { useColorScheme, StyleSheet } from 'react-native';

const light = { background: '#F5F7F5', surface: '#FFFFFF', text: '#192D28', muted: '#60716B', border: '#DCE5DF', accent: '#246B53', onAccent: '#FFFFFF', soft: '#E2F0E8', danger: '#AF3939', warning: '#FFF0D4' };
const dark: typeof light = { background: '#101B17', surface: '#1B2A23', text: '#EFF7F1', muted: '#AABDB0', border: '#35483C', accent: '#A0DDB8', onAccent: '#10271B', soft: '#2B4937', danger: '#FFAAA5', warning: '#493B25' };
export function useTheme() { return useColorScheme() === 'dark' ? dark : light; }
export const tokens = { spacing: 16, radius: 16, touch: 48, maxWidth: 800 };
export const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 20, gap: 16, width: '100%', maxWidth: 800, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { padding: 18, borderRadius: 16, borderWidth: 1, gap: 10 },
  title: { fontSize: 28, fontWeight: '700' }, heading: { fontSize: 20, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 25 }, small: { fontSize: 13, lineHeight: 20 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48, fontSize: 16 },
});

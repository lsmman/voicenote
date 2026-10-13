import { Platform, useColorScheme, StyleSheet, type TextStyle } from 'react-native';

const light = {
  chartPrimary: '#3E63DD', chartSecondary: '#C27C00',
  bg: '#F9F9F8', surface: '#FFFFFF', surfaceRaised: '#FFFFFF', subtle: '#F1F0EF', subtleHover: '#E9E8E6',
  border: '#E2E1DE', borderStrong: '#D3D1CC',
  text: '#21201C', textSecondary: '#63635E', textMuted: '#706F6A',
  accent: '#3E63DD', accentPressed: '#3358D4', accentText: '#3A5BC7', accentSoft: '#EDF2FE', accentContrast: '#FFFFFF',
  ink: '#21201C', inkContrast: '#FFFFFF',
  danger: '#CE2C31', dangerSoft: '#FEEBEC', dangerBorder: '#FDBDBE',
  warning: '#8A5100', warningSoft: '#FFF7C2', warningBorder: '#F3D673',
  success: '#1A7048', successSoft: '#E6F6EB',
  recording: '#E5484D', recordingStrong: '#D13438', recordingSoft: '#FEEBEC', bookmark: '#FFB224',
  overlay: 'rgba(17,17,16,0.40)', focusRing: 'rgba(62,99,221,0.35)',
};
const dark: typeof light = {
  chartPrimary: '#5472E4', chartSecondary: '#BB7D00',
  bg: '#111110', surface: '#191918', surfaceRaised: '#222221', subtle: '#2A2A28', subtleHover: '#31312E',
  border: '#2A2A28', borderStrong: '#3B3A37',
  text: '#EEEEEC', textSecondary: '#B5B3AD', textMuted: '#8F8D86',
  accent: '#3E63DD', accentPressed: '#5472E4', accentText: '#9EB1FF', accentSoft: '#182449', accentContrast: '#FFFFFF',
  ink: '#EEEEEC', inkContrast: '#111110',
  danger: '#FF9592', dangerSoft: '#3B1219', dangerBorder: '#611623',
  warning: '#FFCA16', warningSoft: '#302008', warningBorder: '#5C3D05',
  success: '#3DD68C', successSoft: '#132D21',
  recording: '#E5484D', recordingStrong: '#D13438', recordingSoft: '#3B1219', bookmark: '#FFB224',
  overlay: 'rgba(0,0,0,0.60)', focusRing: 'rgba(110,139,255,0.45)',
};

const aliases = (palette: typeof light) => ({ ...palette, background: palette.bg, muted: palette.textMuted, onAccent: palette.accentContrast, soft: palette.subtle });
const palettes = { light: aliases(light), dark: aliases(dark) };
export function useIsDark() { return useColorScheme() === 'dark'; }
export function useTheme() { return useIsDark() ? palettes.dark : palettes.light; }
export const fontSans = Platform.select({
  web: '"Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif',
  default: undefined,
});

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 };
export const radius = { xs: 4, sm: 6, md: 10, lg: 14, xl: 20, pill: 999 };
export const type = {
  display: { fontSize: 60, lineHeight: 64, fontWeight: '300', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700', letterSpacing: -0.6 },
  heading: { fontSize: 18, lineHeight: 26, fontWeight: '600', letterSpacing: -0.3 },
  rowTitle: { fontSize: 16, lineHeight: 24, fontWeight: '600', letterSpacing: -0.2 },
  reading: { fontSize: 17, lineHeight: 28, letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 24, letterSpacing: -0.1 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: -0.1 },
  small: { fontSize: 13, lineHeight: 20 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.1 },
  eyebrow: { fontSize: 13, lineHeight: 18, fontWeight: '600', letterSpacing: 0.2 },
} satisfies Record<string, TextStyle>;
export const shadow = (dark: boolean) => ({
  sm: { boxShadow: dark ? '0 1px 2px rgba(0,0,0,0.5)' : '0 1px 2px rgba(16,16,15,0.08), 0 0 0 0.5px rgba(16,16,15,0.06)' },
  md: { boxShadow: dark ? '0 6px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.04)' : '0 1px 2px rgba(16,16,15,0.06), 0 6px 16px rgba(16,16,15,0.10)' },
  lg: { boxShadow: dark ? '0 -12px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)' : '0 -2px 8px rgba(16,16,15,0.06), 0 -12px 32px rgba(16,16,15,0.12)' },
});

export const tokens = { spacing: 16, radius: 14, touch: 48, maxWidth: 720 };
export const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { paddingHorizontal: 20, paddingVertical: 16, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  card: { padding: 16, borderRadius: 14, borderWidth: 1, gap: 10 },
  plainRow: { paddingVertical: 10, gap: 4 },
  title: type.title, heading: type.heading, body: type.body, small: type.small,
  input: { ...type.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
});

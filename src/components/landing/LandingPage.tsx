import { useRef, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { setLanguage, useLanguage, type Language } from '../../i18n/language';
import { Button, Notice } from '../../ui/primitives';
import { fontSans, radius, space, type, useTheme } from '../../ui/theme';
import { markWelcomeSeen } from './seen';
import { docsPath, strings } from './strings';

const languages: { code: Language; label: string }[] = [
  { code: 'ko', label: '한국어' }, { code: 'en', label: 'English' }, { code: 'zh', label: '简体中文' },
];
const wave = [12, 24, 16, 36, 48, 30, 20, 42, 58, 34, 22, 46, 28, 52, 38, 18, 30, 44, 24, 14, 32, 50, 36, 20];

export function LandingPage() {
  const c = useTheme();
  const language = useLanguage();
  const s = strings[language];
  const { width, fontScale } = useWindowDimensions();
  const wide = width >= 900 && fontScale < 1.5;
  const columns = width >= 680 && fontScale < 1.5;
  const entering = useRef(false);
  const [busy, setBusy] = useState(false);
  const [docsError, setDocsError] = useState(false);
  const start = async () => {
    if (entering.current) return;
    entering.current = true;
    setBusy(true);
    try { await markWelcomeSeen(); router.replace('/'); }
    finally { entering.current = false; setBusy(false); }
  };
  const openDocs = async () => {
    setDocsError(false);
    const base = (process.env.EXPO_PUBLIC_API_BASE?.trim() || 'https://voicenote-ten-alpha.vercel.app').replace(/\/$/, '');
    try { await Linking.openURL(`${base}${docsPath(language)}`); }
    catch { setDocsError(true); }
  };
  const titleStyle = [type.title, { color: c.text, fontFamily: fontSans }];
  const bodyStyle = [type.body, { color: c.textSecondary, fontFamily: fontSans }];
  const actions = <View style={styles.actions}>
    <Button title={s.start} primary disabled={busy} onPress={() => { void start(); }} style={styles.button} />
    <Button title={s.signin} onPress={() => { void markWelcomeSeen(); router.push('/login'); }} style={styles.button} />
  </View>;

  return <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]}>
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={[styles.container, { paddingHorizontal: wide ? space.xxxl : space.xl }]}>
        <View style={styles.nav}>
          <View style={styles.brand}>
            <View style={[styles.brandMark, { backgroundColor: c.accentSoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {[12, 22, 16].map((height, i) => <View key={i} style={{ width: 3, height, borderRadius: 2, backgroundColor: c.accentText }} />)}
            </View>
            <Text style={[type.heading, { color: c.text }]}>Voicenote</Text>
          </View>
          <View style={[styles.languageGroup, { backgroundColor: c.subtle }]}>
            {languages.map(({ code, label }) => <Pressable key={code} accessibilityRole="button" accessibilityLabel={label}
              accessibilityState={{ selected: language === code }} onPress={() => { void setLanguage(code); }}
              style={({ pressed }) => [styles.language, { backgroundColor: language === code ? c.surface : pressed ? c.subtleHover : 'transparent' }]}>
              <Text style={[type.small, { color: language === code ? c.accentText : c.textSecondary, fontWeight: language === code ? '600' : '400' }]}>{label}</Text>
            </Pressable>)}
          </View>
        </View>

        <View style={[styles.hero, wide && styles.horizontal]}>
          <View style={styles.heroCopy}>
            <Text style={[type.eyebrow, { color: c.accentText }]}>{s.eyebrow}</Text>
            <Text accessibilityRole="header" style={[styles.headline, { color: c.text, fontFamily: fontSans, fontSize: wide ? 52 : 36, lineHeight: wide ? 64 : 46 }]}>{s.headline}</Text>
            <Text style={[type.reading, { color: c.textSecondary, maxWidth: 530 }]}>{s.intro}</Text>
            {actions}
            <Text style={[type.small, { color: c.textMuted }]}>{s.noAccount}</Text>
          </View>
          <View style={[styles.preview, { backgroundColor: c.surface, borderColor: c.border }, wide && { flex: 0.9 }]}>
            <Text style={[type.eyebrow, { color: c.textMuted }]}>{s.preview}</Text>
            <Text style={[type.heading, { color: c.text }]}>{s.previewTitle}</Text>
            <Text style={[type.small, { color: c.success }]}>✓ {s.saved}</Text>
            <View style={[styles.wave, { backgroundColor: c.accentSoft }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {wave.map((height, i) => <View key={i} style={{ flex: 1, maxWidth: 6, height, borderRadius: 3, backgroundColor: c.accentText, opacity: i % 3 === 0 ? 0.45 : 0.85 }} />)}
            </View>
            <Text style={[type.caption, { color: c.textMuted }]}>{s.transcript} · 00:24</Text>
            <Text style={[type.body, { color: c.text }]}>{s.quote}</Text>
            <View style={[styles.summary, { backgroundColor: c.subtle }]}>
              <Text style={[type.caption, { color: c.accentText }]}>{s.summary}</Text>
              <Text style={[type.body, { color: c.text }]}>{s.summaryText}</Text>
            </View>
            <Text style={[type.small, { color: c.textSecondary }]}>☆ {s.bookmark}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={titleStyle}>{s.featuresTitle}</Text>
          <View style={styles.grid}>
            {s.features.map((feature, i) => <View key={i} style={[styles.feature, { width: columns ? '48%' : '100%', backgroundColor: c.surface, borderColor: c.border }]}>
              <Text style={[type.eyebrow, { color: c.accentText }]}>0{i + 1}</Text>
              <Text accessibilityRole="header" style={[type.heading, { color: c.text }]}>{feature.title}</Text>
              <Text style={bodyStyle}>{feature.body}</Text>
            </View>)}
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={titleStyle}>{s.howTitle}</Text>
          <View style={[styles.steps, wide && styles.horizontal]}>
            {s.steps.map((step, i) => <View key={i} style={[styles.step, { borderTopColor: c.borderStrong }]}>
              <Text style={[type.title, { color: c.accentText }]}>0{i + 1}</Text>
              <Text style={[type.heading, { color: c.text }]}>{step.title}</Text>
              <Text style={bodyStyle}>{step.body}</Text>
            </View>)}
          </View>
        </View>

        <View style={[styles.infoRow, wide && styles.horizontal]}>
          <View style={[styles.info, { backgroundColor: c.subtle }]}>
            <Text accessibilityRole="header" style={titleStyle}>{s.privacyTitle}</Text>
            <Text style={bodyStyle}>{s.privacy}</Text>
          </View>
          <View style={[styles.info, { backgroundColor: c.accentSoft }]}>
            <Text style={[type.eyebrow, { color: c.accentText }]}>MCP · AI</Text>
            <Text accessibilityRole="header" style={titleStyle}>{s.mcpTitle}</Text>
            <Text style={bodyStyle}>{s.mcp}</Text>
            {Platform.OS === 'web'
              ? <a href={docsPath(language)} style={{ color: c.accentText, fontFamily: fontSans, fontSize: 15, fontWeight: 600, paddingTop: 12, paddingBottom: 12, lineHeight: '24px' }}>{s.docs} ↗</a>
              : <Button title={`${s.docs} ↗`} onPress={() => { void openDocs(); }} />}
            {docsError && <Notice text={s.docsError} error />}
          </View>
        </View>

        <View style={[styles.closing, { borderColor: c.border }]}>
          <Text accessibilityRole="header" style={[titleStyle, { textAlign: 'center' }]}>{s.closing}</Text>
          <Text style={[bodyStyle, { textAlign: 'center' }]}>{s.closingBody}</Text>
          {actions}
        </View>
        <Text style={[type.small, styles.footer, { color: c.textMuted }]}>{s.footer}</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, scroll: { flexGrow: 1 },
  container: { width: '100%', maxWidth: 1160, alignSelf: 'center' },
  nav: { paddingVertical: space.xl, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: space.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  brandMark: { width: 36, height: 36, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  languageGroup: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: radius.md, padding: 3 },
  language: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radius.sm },
  hero: { paddingTop: space.xxxl, paddingBottom: 64, gap: space.xxxl }, horizontal: { flexDirection: 'row' },
  heroCopy: { flex: 1, justifyContent: 'center', gap: space.xl, minWidth: 0 },
  headline: { fontWeight: '700', letterSpacing: -1.2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.sm }, button: { minHeight: 48 },
  preview: { borderWidth: 1, borderRadius: radius.xl, padding: space.xxl, gap: space.md, minWidth: 0 },
  wave: { height: 86, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: space.md, borderRadius: radius.md, marginVertical: space.sm },
  summary: { padding: space.lg, borderRadius: radius.md, gap: space.sm },
  section: { gap: space.xxl, paddingBottom: 56 }, grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.lg },
  feature: { padding: space.xxl, borderWidth: 1, borderRadius: radius.lg, gap: space.md },
  steps: { gap: space.xxl }, step: { flex: 1, borderTopWidth: 1, paddingTop: space.xl, gap: space.md },
  infoRow: { gap: space.xl, paddingBottom: 56 }, info: { flex: 1, padding: space.xxl, borderRadius: radius.xl, gap: space.lg },
  closing: { alignItems: 'center', borderTopWidth: 1, paddingVertical: space.huge, gap: space.lg },
  footer: { textAlign: 'center', paddingBottom: space.xxxl },
});

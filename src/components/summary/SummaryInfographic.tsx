import { t, useT } from '../../i18n';
import { useLanguage } from '../../i18n/language';
import { useMemo, useState, type PropsWithChildren } from 'react';
import { Text, View } from 'react-native';
import type { Memo, Segment, Summary } from '../../core/types';
import { formatTimestamp } from '../../ui/format';
import { Button } from '../../ui/primitives';
import { keywordCounts, speechBuckets, summaryMarkers, summaryStatValues } from '../../ui/summaryStats';
import { radius, space, styles, type, useTheme } from '../../ui/theme';
import { SpeechFlow } from './SpeechFlow';

function Card({ title, children }: PropsWithChildren<{ title: string }>) {
  useT();
  const c = useTheme();
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border, padding: space.xl, gap: space.xl }]}>
    <Text accessibilityRole="header" style={[type.heading, { color: c.text }]}>{title}</Text>{children}
  </View>;
}
function Timestamp({ atMs, onSeek }: { atMs: number | null; onSeek: (ms: number) => void }) {
  useT();
  const c = useTheme();
  return atMs === null ? null : <Button compact title={t('listenFrom', { p0: formatTimestamp(atMs) })} onPress={() => onSeek(atMs)} style={{ alignSelf: 'flex-start', borderRadius: radius.pill, backgroundColor: c.subtle, borderWidth: 0 }} />;
}
export function SummaryInfographic({ summary, segments, memos, durationMs, onSeek }: {
  summary: Summary; segments: Segment[]; memos: Memo[]; durationMs: number; onSeek: (ms: number) => void;
}) {
  useT();
  const c = useTheme();
  const language = useLanguage();
  const [width, setWidth] = useState(0);
  const data = useMemo(() => ({
    stats: summaryStatValues(durationMs, segments, summary, memos),
    buckets: speechBuckets(segments, durationMs),
    markers: summaryMarkers(summary, memos, durationMs),
    keywords: keywordCounts(summary.keywords, segments),
  // Helpers translate through getLanguage(); invalidate their cached labels on a language change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [durationMs, segments, summary, memos, language]);
  return <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ gap: space.xxl }}>
    <Card title={t('keyNumbers')}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {data.stats.map(stat => <View key={stat.label} style={{ width: width >= 600 ? '23%' : '48%', flexGrow: 1, padding: space.md, gap: space.sm, backgroundColor: c.subtle, borderRadius: radius.md }}>
          <Text adjustsFontSizeToFit numberOfLines={1} style={{ fontSize: 25, lineHeight: 34, fontWeight: '600', fontVariant: ['tabular-nums'], color: c.text }}>{stat.value}</Text>
          <Text style={[type.caption, { color: c.textMuted }]}>{stat.label}</Text>
        </View>)}
      </View>
    </Card>
    <Card title={t('speechFlow')}><SpeechFlow buckets={data.buckets} markers={data.markers} durationMs={Math.max(0, durationMs)} onSeek={onSeek} /></Card>
    <Card title={t('keyPoints')}>
      {!summary.summary.length && <Text style={[type.body, { color: c.textMuted }]}>{t('noKeyPoints')}</Text>}
      <View>{summary.summary.map((item, i) => <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ width: 28, alignItems: 'center' }}>
          <View style={{ width: 28, height: 28, borderRadius: radius.pill, backgroundColor: c.chartPrimary, alignItems: 'center', justifyContent: 'center' }}><Text style={[type.caption, { color: c.accentContrast }]}>{i + 1}</Text></View>
          {i < summary.summary.length - 1 && <View style={{ flex: 1, width: 1, backgroundColor: c.border, marginVertical: space.xs }} />}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: space.sm, paddingBottom: i < summary.summary.length - 1 ? space.xxl : 0 }}><Text style={[type.reading, { color: c.text }]}>{item.text}</Text><Timestamp atMs={item.atMs} onSeek={onSeek} /></View>
      </View>)}</View>
    </Card>
    <Card title={t('keywords')}>
      {!data.keywords.length && <Text style={[type.body, { color: c.textMuted }]}>{t('noKeywords')}</Text>}
      {data.keywords.map((item, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessible accessibilityLabel={t('keywordCount', { p0: item.keyword, p1: item.count })}>
        <Text style={[type.small, { width: '32%', color: c.textSecondary }]}>{item.keyword}</Text>
        <View style={{ flex: 1, height: 6, borderRadius: radius.xs, backgroundColor: c.subtle }}><View style={{ width: `${item.count / data.keywords[0].count * 100}%`, height: 6, borderRadius: radius.xs, backgroundColor: c.chartPrimary }} /></View>
        <Text style={[type.small, { minWidth: 28, textAlign: 'right', fontVariant: ['tabular-nums'], color: c.text }]}>{item.count}</Text>
      </View>)}
    </Card>
    <Card title={t('todos')}>
      {!summary.todos.length && <Text style={[type.body, { color: c.textMuted }]}>{t('noTodos')}</Text>}
      {summary.todos.map((item, i) => <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
        <View accessible={false} style={{ width: 18, height: 18, marginTop: 5, borderWidth: 1.5, borderColor: c.textMuted, borderRadius: radius.xs }} />
        <View style={{ flex: 1, minWidth: 0, gap: space.sm }}><Text style={[type.reading, { color: c.text }]}>{item.text}</Text><Timestamp atMs={item.atMs} onSeek={onSeek} /></View>
      </View>)}
    </Card>
  </View>;
}

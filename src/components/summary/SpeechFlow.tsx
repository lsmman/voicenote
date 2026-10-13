import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatTimestamp } from '../../ui/format';
import { Button } from '../../ui/primitives';
import { radius, space, type, useTheme } from '../../ui/theme';
import type { SpeechBucket, SummaryMarker } from '../../ui/summaryStats';

const countLabel = (value: number) => String(Math.round(value * 10) / 10);
const rangeLabel = (bucket: SpeechBucket) => `${formatTimestamp(bucket.startMs)}–${formatTimestamp(bucket.endMs)}`;
const markerSize = 24;
export function SpeechFlow({ buckets, markers, durationMs, onSeek }: {
  buckets: SpeechBucket[]; markers: SummaryMarker[]; durationMs: number; onSeek: (ms: number) => void;
}) {
  const c = useTheme();
  const [width, setWidth] = useState(1);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...buckets.map(bucket => bucket.characters));
  // Stack colliding targets without changing their horizontal time position.
  const placed = useMemo(() => {
    const ends: number[] = [];
    return [...markers].sort((a, b) => a.fraction - b.fraction).map(marker => {
      const x = marker.fraction * width;
      let row = ends.findIndex(end => x - markerSize / 2 >= end + 2);
      if (row === -1) row = ends.length;
      ends[row] = x + markerSize / 2;
      return { ...marker, row };
    });
  }, [markers, width]);
  const reveal = (text: string) => ({
    onHoverIn: () => setTooltip(text), onHoverOut: () => setTooltip(null),
    onFocus: () => setTooltip(text), onBlur: () => setTooltip(null),
    onLongPress: () => setTooltip(text),
  });
  return <View style={{ gap: space.md }}>
    <Text style={[type.small, { color: c.textMuted }]}>시간대별 발화량 · 글자 수</Text>
    <View style={{ paddingHorizontal: markerSize / 2 }}>
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ height: Math.max(1, ...placed.map(marker => marker.row + 1)) * 28, marginBottom: space.sm }}>
        {placed.map(marker => <Pressable key={marker.id} accessibilityRole="button" accessibilityLabel={`${marker.kind === 'point' ? `핵심 포인트 ${marker.number}` : marker.kind === 'todo' ? '할 일' : '메모'} · ${formatTimestamp(marker.atMs)} · ${marker.text}`} {...reveal(Array.from(marker.text).slice(0, 60).join('') + (Array.from(marker.text).length > 60 ? '…' : ''))} onPress={() => onSeek(marker.atMs)}
          style={{ position: 'absolute', left: `${marker.fraction * 100}%`, marginLeft: -markerSize / 2, top: marker.row * 28, width: markerSize, height: markerSize, borderRadius: radius.pill, backgroundColor: marker.kind === 'point' ? c.chartPrimary : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={[type.caption, { color: marker.kind === 'point' ? c.accentContrast : marker.kind === 'memo' ? c.chartSecondary : c.text, fontSize: marker.kind === 'point' ? 12 : 18 }]}>{marker.kind === 'point' ? marker.number : marker.kind === 'todo' ? '✓' : '★'}</Text>
        </Pressable>)}
      </View>
      <View style={{ height: 136, borderBottomWidth: 1, borderBottomColor: c.border }}>
        {buckets.map((bucket, index) => {
          const label = `${rangeLabel(bucket)} · ${countLabel(bucket.characters)}자`;
          return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${label}, 이 위치부터 듣기`} {...reveal(label)} onPress={() => onSeek(bucket.startMs)} style={{ position: 'absolute', left: `${bucket.startMs / durationMs * 100}%`, width: `${(bucket.endMs - bucket.startMs) / durationMs * 100}%`, height: '100%', paddingHorizontal: 1, justifyContent: 'flex-end' }}>
            <View style={{ height: bucket.characters / max * 128, width: '100%', backgroundColor: c.chartPrimary, borderTopLeftRadius: radius.xs, borderTopRightRadius: radius.xs }} />
          </Pressable>;
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}>
        {[0, durationMs / 2, durationMs].map((ms, i) => <Text key={i} style={[type.caption, { color: c.textMuted, fontVariant: ['tabular-nums'] }]}>{formatTimestamp(ms)}</Text>)}
      </View>
    </View>
    {!buckets.length && <Text style={[type.small, { color: c.textMuted }]}>녹음 길이가 없어 대화 흐름을 표시할 수 없어요.</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg }}>
      <Text style={[type.small, { color: c.textSecondary }]}><Text style={{ color: c.chartPrimary }}>●</Text> 핵심 포인트</Text>
      <Text style={[type.small, { color: c.textSecondary }]}><Text style={{ color: c.text }}>✓</Text> 할 일</Text>
      <Text style={[type.small, { color: c.textSecondary }]}><Text style={{ color: c.chartSecondary }}>★</Text> 메모</Text>
    </View>
    <View style={{ minHeight: 44, padding: space.sm, borderRadius: radius.sm, backgroundColor: c.subtle }} accessibilityLiveRegion="polite">
      <Text style={[type.small, { color: tooltip ? c.text : c.textMuted }]}>{tooltip ?? '막대와 표시를 누르면 재생돼요. 마우스를 올리거나 길게 눌러 자세히 보세요.'}</Text>
    </View>
    <Button compact title={table ? '표 닫기' : '표로 보기'} onPress={() => setTable(value => !value)} style={{ alignSelf: 'flex-start' }} />
    {table && <View accessibilityLabel="시간대별 글자 수 표">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.borderStrong }}>
        <Text style={[type.label, { color: c.text }]}>시간</Text><Text style={[type.label, { color: c.text }]}>글자 수</Text>
      </View>
      {buckets.map((bucket, i) => <View key={i} accessible accessibilityLabel={`${rangeLabel(bucket)}, ${countLabel(bucket.characters)}자`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm, borderBottomWidth: 1, borderColor: c.border }}>
        <Text style={[type.small, { color: c.textSecondary, fontVariant: ['tabular-nums'] }]}>{rangeLabel(bucket)}</Text><Text style={[type.small, { color: c.text, fontVariant: ['tabular-nums'] }]}>{countLabel(bucket.characters)}</Text>
      </View>)}
    </View>}
  </View>;
}

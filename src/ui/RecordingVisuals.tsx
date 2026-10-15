import { t, useT } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Text, View } from 'react-native';
import { type, useTheme } from './theme';

/** Presentation-only history; it never subscribes to or changes the recording pipeline. */
export function LevelMeter({ level, paused }: { level: number; paused: boolean }) {
  useT();
  const c = useTheme(); const history = useRef<number[]>(Array(48).fill(0));
  const [bars, setBars] = useState(history.current);
  useEffect(() => {
    history.current = [...history.current.slice(1), Math.min(1, Math.max(0, level))];
    setBars(history.current);
  }, [level]);
  return <View accessibilityLabel={t('micLevel')} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100) }} style={{ height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: 360, alignSelf: 'center', width: '100%' }}>
    {bars.map((value, index) => <View key={index} style={{ width: 3, borderRadius: 1.5, height: Math.max(3, Math.sqrt(value) * 40), backgroundColor: paused ? c.borderStrong : value > 0.9 ? c.recording : c.text, opacity: 0.25 + index / 47 * 0.75 }} />)}
  </View>;
}

export function RecordingStatus({ text, recording, paused }: { text: string; recording: boolean; paused: boolean }) {
  useT();
  const c = useTheme(); const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let alive = true; let animation: Animated.CompositeAnimation | undefined;
    const update = (reduced: boolean) => {
      animation?.stop(); opacity.setValue(1);
      if (alive && recording && !reduced) {
        animation = Animated.loop(Animated.sequence([
          Animated.timing(opacity, { toValue: 0.35, duration: 600, useNativeDriver: true, isInteraction: false }),
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true, isInteraction: false }),
        ]));
        animation.start();
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) update(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', update);
    return () => { alive = false; subscription.remove(); animation?.stop(); };
  }, [recording, opacity]);
  return <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', height: 26, paddingHorizontal: 10, borderRadius: 999, gap: 6, backgroundColor: recording ? c.recordingSoft : paused ? c.subtle : 'transparent' }}>
    {(recording || paused) && <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: recording ? c.recording : c.textMuted, opacity: recording ? opacity : 1 }} />}
    <Text style={[type.caption, { fontSize: 13, fontWeight: '600', color: recording ? c.danger : paused ? c.textSecondary : c.textMuted }]}>{text}</Text>
  </View>;
}

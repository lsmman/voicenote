import { t, useT } from '../i18n';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, Text, View, useWindowDimensions } from 'react-native';
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import type { AudioChunk, Memo } from '../core/types';
import { store, sync } from '../services';
import { Button, Notice } from '../ui/primitives';
import { shadow, styles, useIsDark, useTheme } from '../ui/theme';
import { chunkAtTime, chunkByIndex, chunkDuration, sourceIsReady, timelineDuration } from './playerMath';
import { Timeline } from './Timeline';
import { resolveLocalPath } from '../recorder/paths';
export interface ChunkPlayerHandle { seek(ms: number, play?: boolean): void; pause(): void }
interface Props { chunks: AudioChunk[]; memos: Memo[]; onPosition: (ms: number) => void }
type Target = NonNullable<ReturnType<typeof chunkAtTime>>;
export const ChunkPlayer = forwardRef<ChunkPlayerHandle, Props>(function ChunkPlayer({ chunks, memos, onPosition }, ref) {
  useT();
  const c = useTheme(); const dark = useIsDark(); const { width } = useWindowDimensions(); const player = useRef<AudioPlayer | null>(null);
  const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [rate, setRate] = useState(1);
  const [reported, setReported] = useState<Record<number, number>>({}); const durations = useRef<Record<number, number>>({});
  const current = useRef<Target | null>(null); const objectUrl = useRef<string | null>(null);
  const generation = useRef(0); const sourceGeneration = useRef(0); const transitioning = useRef(false);
  const desiredPlaying = useRef(false); const speed = useRef(1); const mounted = useRef(true);
  const cancelWait = useRef<(() => void) | null>(null); const removeStatus = useRef<(() => void) | null>(null);
  const latest = useRef({ chunks, onPosition }); latest.current = { chunks, onPosition };
  const duration = timelineDuration(chunks, reported);
  const loadRef = useRef<(target: Target, play: boolean) => void>(() => {});
  const publish = useCallback((ms: number) => { setPosition(ms); latest.current.onPosition(ms); }, []);
  const rememberDuration = useCallback((chunk: AudioChunk, seconds: number) => {
    if (!chunk.durationMs && Number.isFinite(seconds) && seconds > 0 && durations.current[chunk.seq] !== seconds * 1000) {
      durations.current = { ...durations.current, [chunk.seq]: seconds * 1000 }; setReported(durations.current);
    }
  }, []);
  const disposeSource = useCallback(() => {
    sourceGeneration.current++;
    removeStatus.current?.(); removeStatus.current = null;
    player.current?.remove(); player.current = null; current.current = null;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null;
  }, []);
  const load = useCallback((target: Target, play: boolean) => {
    const version = ++generation.current; cancelWait.current?.();
    transitioning.current = true; desiredPlaying.current = play;
    setLoading(true); setError(''); player.current?.pause(); setPlaying(false);
    publish(target.chunk.startMs + target.offsetMs);
    void (async () => {
      if (current.current?.chunk.seq !== target.chunk.seq || current.current?.chunk.noteId !== target.chunk.noteId) {
        disposeSource();
        let uri: string | null = null; let createdUrl: string | null = null;
        if (target.chunk.localPath) {
          if (Platform.OS === 'web') {
            const blob = await store.getAudioBlob?.(target.chunk.localPath).catch(() => null);
            if (blob) { createdUrl = URL.createObjectURL(blob); uri = createdUrl; }
          } else uri = resolveLocalPath(target.chunk.localPath);
        }
        if (!uri && target.chunk.remotePath) uri = await sync.chunkUrl(target.chunk.remotePath);
        if (version !== generation.current || !mounted.current) { if (createdUrl) URL.revokeObjectURL(createdUrl); return; }
        if (!uri) throw new Error('missing audio');
        objectUrl.current = createdUrl;
        // A distinct player per source gives native/web events an unambiguous source id.
        const audio = createAudioPlayer(null, { updateInterval: 200 }); player.current = audio;
        const sourceVersion = ++sourceGeneration.current;
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const finish = (failure?: Error) => {
            if (finished) return; finished = true;
            clearTimeout(timeout); subscription.remove(); cancelWait.current = null;
            if (failure) reject(failure); else resolve();
          };
          const check = (status: AudioStatus) => {
            if (sourceVersion !== sourceGeneration.current || status.id !== audio.id || version !== generation.current) return;
            if (status.error) finish(new Error('playback load failed'));
            else if (sourceIsReady(status, audio.id, sourceVersion, sourceGeneration.current)) { rememberDuration(target.chunk, status.duration); finish(); }
          };
          const subscription = audio.addListener('playbackStatusUpdate', check);
          const timeout = setTimeout(() => finish(new Error('load timeout')), 20000);
          cancelWait.current = () => finish(new Error('superseded'));
          try { audio.replace({ uri }); check(audio.currentStatus); }
          catch { finish(new Error('replace failed')); }
        });
        if (version !== generation.current || !mounted.current) return;
        current.current = target;
        const subscription = audio.addListener('playbackStatusUpdate', status => {
          if (!mounted.current || transitioning.current || sourceVersion !== sourceGeneration.current || status.id !== audio.id) return;
          if (status.error) { desiredPlaying.current = false; setPlaying(false); setError(t('playbackInterrupted')); return; }
          rememberDuration(target.chunk, status.duration);
          const ms = target.chunk.startMs + Math.min(chunkDuration(target.chunk, durations.current), status.currentTime * 1000);
          publish(ms); setPlaying(status.playing);
          if (status.didJustFinish && desiredPlaying.current) {
            const next = chunkByIndex(latest.current.chunks, target.index + 1);
            if (next) loadRef.current(next, true);
            else { desiredPlaying.current = false; setPlaying(false); publish(timelineDuration(latest.current.chunks, durations.current)); }
          }
        });
        removeStatus.current = () => subscription.remove();
      }
      const audio = player.current;
      if (!audio) return;
      const offset = Math.min(target.offsetMs, chunkDuration(target.chunk, durations.current));
      await audio.seekTo(offset / 1000);
      if (version !== generation.current || !mounted.current) return;
      publish(target.chunk.startMs + offset); audio.setPlaybackRate(speed.current);
      transitioning.current = false; setLoading(false);
      if (desiredPlaying.current) { audio.play(); setPlaying(true); }
    })().catch(() => {
      if (version !== generation.current || !mounted.current) return;
      transitioning.current = false; desiredPlaying.current = false; disposeSource();
      setLoading(false); setPlaying(false); setError(t('playbackError'));
    });
  }, [disposeSource, publish, rememberDuration]);
  loadRef.current = load;
  const seek = useCallback((ms: number, play = desiredPlaying.current) => {
    const target = chunkAtTime(latest.current.chunks, ms, durations.current); if (target) load(target, play);
  }, [load]);
  useImperativeHandle(ref, () => ({ seek, pause() { desiredPlaying.current = false; player.current?.pause(); setPlaying(false); } }), [seek]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; cancelWait.current?.(); disposeSource(); };
  }, [disposeSource]);
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
    <Timeline durationMs={duration} positionMs={position} memos={memos} onSeek={ms => seek(ms)} />
    <View style={styles.row}>
      <Button title={loading ? t('loading') : playing ? t('pause') : t('play')} primary style={{ minWidth: 88 }} disabled={!chunks.length || loading} onPress={() => {
        if (playing) { desiredPlaying.current = false; player.current?.pause(); setPlaying(false); }
        else seek(position >= duration ? 0 : position, true);
      }} />
      <Button ghost compact title={t('backSeconds')} disabled={!chunks.length} onPress={() => seek(Math.max(0, position - 10000))} />
      <Button ghost compact title={t('forwardSeconds')} disabled={!chunks.length} onPress={() => seek(Math.min(duration, position + 10000))} />
      <View style={{ flexDirection: 'row', backgroundColor: c.subtle, borderRadius: 10, padding: 3, gap: 2, marginLeft: 'auto', ...(width < 420 ? { flexBasis: '100%' } : {}) }}>{[0.5, 1, 1.5, 2].map(value => <Button ghost compact style={{ flex: width < 420 ? 1 : undefined, borderRadius: 7, backgroundColor: rate === value ? c.surfaceRaised : 'transparent', ...(rate === value ? shadow(dark).sm : {}) }} key={value} title={`${value}×${rate === value ? ' ✓' : ''}`} onPress={() => { speed.current = value; setRate(value); try { player.current?.setPlaybackRate(value); } catch { setError(t('playbackSpeedError')); } }} />)}</View>
    </View>
    {!chunks.length && <Text style={[styles.small, { color: c.muted }]}>{t('noAudio')}</Text>}
    {!!error && <Notice text={error} error />}
  </View>;
});

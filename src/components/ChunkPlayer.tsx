import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import type { AudioChunk, Memo } from '../core/types';
import { store, sync } from '../services';
import { Button, Notice } from '../ui/primitives';
import { styles, useTheme } from '../ui/theme';
import { chunkAtTime, timelineDuration } from './playerMath';
import { Timeline } from './Timeline';
export interface ChunkPlayerHandle { seek(ms: number, play?: boolean): void; pause(): void }
interface Props { chunks: AudioChunk[]; memos: Memo[]; onPosition: (ms: number) => void }
export const ChunkPlayer = forwardRef<ChunkPlayerHandle, Props>(function ChunkPlayer({ chunks, memos, onPosition }, ref) {
  const c = useTheme(); const player = useAudioPlayer(null, { updateInterval: 200 });
  const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [rate, setRate] = useState(1);
  const current = useRef<AudioChunk | null>(null); const objectUrl = useRef<string | null>(null);
  const generation = useRef(0); const transitioning = useRef(false); const desiredPlaying = useRef(false); const speed = useRef(1);
  const mounted = useRef(true); const cancelWait = useRef<(() => void) | null>(null);
  const latest = useRef({ chunks, onPosition }); latest.current = { chunks, onPosition };
  const duration = timelineDuration(chunks);
  const seekRef = useRef<(ms: number, play?: boolean) => void>(() => {});
  const seek = useCallback((ms: number, play = desiredPlaying.current) => {
    const target = chunkAtTime(latest.current.chunks, ms);
    if (!target) return;
    const version = ++generation.current;
    cancelWait.current?.();
    transitioning.current = true; desiredPlaying.current = play;
    setLoading(true); setError(''); player.pause(); setPlaying(false);
    const publish = (value: number) => { setPosition(value); latest.current.onPosition(value); };
    publish(target.chunk.startMs + target.offsetMs);
    void (async () => {
      if (current.current?.seq !== target.chunk.seq || current.current?.noteId !== target.chunk.noteId) {
        let uri: string | null = null; let createdUrl: string | null = null;
        if (target.chunk.localPath) {
          if (Platform.OS === 'web') {
            const blob = await store.getAudioBlob?.(target.chunk.localPath).catch(() => null);
            if (blob) { createdUrl = URL.createObjectURL(blob); uri = createdUrl; }
          } else uri = target.chunk.localPath;
        }
        if (!uri && target.chunk.remotePath) uri = await sync.chunkUrl(target.chunk.remotePath);
        if (version !== generation.current || !mounted.current) { if (createdUrl) URL.revokeObjectURL(createdUrl); return; }
        if (!uri) throw new Error('missing audio');
        const previousUrl = objectUrl.current;
        current.current = null;
        await new Promise<void>((resolve, reject) => {
          let finished = false;
          const finish = (failure?: Error) => {
            if (finished) return; finished = true;
            clearTimeout(timeout); subscription.remove(); cancelWait.current = null;
            if (failure) reject(failure); else resolve();
          };
          const subscription = player.addListener('playbackStatusUpdate', status => {
            if (status.error) finish(new Error('playback load failed'));
            else if (status.isLoaded) finish();
          });
          const timeout = setTimeout(() => finish(new Error('load timeout')), 20000);
          cancelWait.current = () => finish(new Error('superseded'));
          try { player.replace({ uri }); objectUrl.current = createdUrl; if (previousUrl) URL.revokeObjectURL(previousUrl); }
          catch { if (createdUrl) URL.revokeObjectURL(createdUrl); finish(new Error('replace failed')); }
        });
        if (version !== generation.current || !mounted.current) return;
        current.current = target.chunk;
      }
      await player.seekTo(target.offsetMs / 1000);
      if (version !== generation.current || !mounted.current) return;
      player.setPlaybackRate(speed.current);
      transitioning.current = false; setLoading(false);
      if (desiredPlaying.current) { player.play(); setPlaying(true); }
    })().catch(() => {
      if (version !== generation.current || !mounted.current) return;
      transitioning.current = false; desiredPlaying.current = false; current.current = null;
      setLoading(false); setPlaying(false); setError('오디오를 재생하지 못했어요. 연결 상태를 확인하고 다시 재생해 주세요.');
    });
  }, [player]);
  seekRef.current = seek;
  useImperativeHandle(ref, () => ({ seek, pause() { desiredPlaying.current = false; player.pause(); setPlaying(false); } }), [seek, player]);
  useEffect(() => {
    mounted.current = true;
    const subscription = player.addListener('playbackStatusUpdate', status => {
      if (transitioning.current || !current.current) return;
      if (status.error) { desiredPlaying.current = false; setPlaying(false); setError('오디오 재생이 중단됐어요. 다시 재생해 주세요.'); return; }
      const chunk = current.current;
      const ms = chunk.startMs + Math.min(chunk.durationMs, status.currentTime * 1000);
      setPosition(ms); latest.current.onPosition(ms); setPlaying(status.playing);
      if (status.didJustFinish && desiredPlaying.current) {
        const index = latest.current.chunks.findIndex(item => item.seq === chunk.seq);
        const next = latest.current.chunks[index + 1];
        if (next) seekRef.current(next.startMs, true);
        else { desiredPlaying.current = false; setPlaying(false); const end = timelineDuration(latest.current.chunks); setPosition(end); latest.current.onPosition(end); }
      }
    });
    return () => { mounted.current = false; generation.current++; cancelWait.current?.(); subscription.remove(); if (objectUrl.current) { URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; } };
  }, [player]);
  return <View style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }]}>
    <Timeline durationMs={duration} positionMs={position} memos={memos} onSeek={ms => seek(ms)} />
    <View style={styles.row}>
      <Button title={loading ? '불러오는 중…' : playing ? '일시정지' : '재생'} primary disabled={!chunks.length || loading} onPress={() => {
        if (playing) { desiredPlaying.current = false; player.pause(); setPlaying(false); }
        else seek(position >= duration ? 0 : position, true);
      }} />
      <Button title="−10초" disabled={!chunks.length} onPress={() => seek(Math.max(0, position - 10000))} />
      <Button title="+10초" disabled={!chunks.length} onPress={() => seek(Math.min(duration, position + 10000))} />
      {[0.5, 1, 1.5, 2].map(value => <Button key={value} title={`${value}×${rate === value ? ' ✓' : ''}`} onPress={() => { speed.current = value; setRate(value); try { player.setPlaybackRate(value); } catch { setError('배속을 변경하지 못했어요.'); } }} />)}
    </View>
    {!chunks.length && <Text style={{ color: c.muted }}>저장된 오디오가 없어요.</Text>}
    {!!error && <Notice text={error} error />}
  </View>;
});

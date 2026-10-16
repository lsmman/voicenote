import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import type { LiveSessionState, Pipeline } from '../pipeline/types';

export type ScheduledStart = { id: string; startAt: number; stopAt: number | null };
type Window = Omit<ScheduledStart, 'id'>;
export type ScheduleError = 'invalidTime' | 'overlap' | 'tooMany';
const KEY = 'voicenote.scheduledStarts';
const OLD_KEY = 'voicenote.scheduledStart';
const MAX_DELAY = 2 ** 31 - 1;
let snapshot: { schedules: ScheduledStart[]; missed: number[] } = { schedules: [], missed: [] };
const listeners = new Set<() => void>();
let revision = 0;
let sequence = 0;
let writes = Promise.resolve();
let recheck: (() => void) | null = null;
let stopWatcher: (() => void) | null = null;
let launched: { schedule: ScheduledStart; noteId: string | null; stopAt: number | null } | null = null;
const emit = () => listeners.forEach(listener => listener());
export const getScheduledStart = () => snapshot;
export function subscribeScheduledStart(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useScheduledStarts() {
  return useSyncExternalStore(subscribeScheduledStart, getScheduledStart, getScheduledStart);
}
function valid(value: unknown): value is Window {
  if (!value || typeof value !== 'object') return false;
  const { startAt, stopAt } = value as Window;
  return typeof startAt === 'number' && Number.isFinite(startAt) && startAt > 0 && startAt <= 8.64e15
    && (stopAt === null || (typeof stopAt === 'number' && Number.isFinite(stopAt) && stopAt > startAt && stopAt <= 8.64e15));
}
const id = () => `${Date.now()}-${++sequence}`;
const sorted = (items: ScheduledStart[]) => [...items].sort((a, b) => a.startAt - b.startAt);
function persist(items: ScheduledStart[]) {
  // Serialize mutations and migration; remove legacy data only after the new write succeeds.
  writes = writes.then(async () => {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(items));
      await AsyncStorage.removeItem(OLD_KEY);
    } catch { /* Storage unavailable: retain in-memory behavior. */ }
  });
  return writes;
}
export async function loadScheduledStart() {
  const version = revision;
  try {
    await writes;
    const raw = await AsyncStorage.getItem(KEY);
    const legacy = raw === null ? await AsyncStorage.getItem(OLD_KEY) : null;
    if (version !== revision) return;
    const value: unknown = JSON.parse(raw ?? legacy ?? 'null');
    const seen = new Set<string>();
    const schedules = raw === null
      ? (valid(value) ? [{ ...value, id: id() }] : [])
      : (Array.isArray(value) ? value.filter((item): item is ScheduledStart => {
        if (!valid(item) || typeof (item as ScheduledStart).id !== 'string' || !(item as ScheduledStart).id || seen.has((item as ScheduledStart).id)) return false;
        seen.add((item as ScheduledStart).id); return true;
      }) : []);
    snapshot = { ...snapshot, schedules: sorted(schedules).slice(0, 20) };
    revision++;
    void persist(snapshot.schedules);
    emit();
    recheck?.();
    await writes;
  } catch { /* Keep the in-memory schedules. */ }
}
export function addScheduledStart(schedule: Window): ScheduleError | null {
  if (!valid(schedule) || schedule.startAt <= Date.now()) return 'invalidTime';
  if (snapshot.schedules.length >= 20) return 'tooMany';
  const end = (item: Window) => item.stopAt ?? item.startAt + 60_000;
  if (snapshot.schedules.some(item => schedule.startAt < end(item) && item.startAt < end(schedule))) return 'overlap';
  let nextId = id();
  while (snapshot.schedules.some(item => item.id === nextId)) nextId = id();
  revision++;
  snapshot = { ...snapshot, schedules: sorted([...snapshot.schedules, { ...schedule, id: nextId }]) };
  void persist(snapshot.schedules);
  emit(); recheck?.();
  return null;
}
export function removeScheduledStart(id: string) {
  revision++;
  snapshot = { ...snapshot, schedules: snapshot.schedules.filter(item => item.id !== id) };
  const saved = persist(snapshot.schedules);
  emit(); recheck?.();
  return saved;
}
export function dismissMissedStart() {
  snapshot = { ...snapshot, missed: [] };
  emit();
}
/** The record screen confirms which session belongs to this scheduled navigation. */
export function completeScheduledRecordingStart(scheduleId: string, noteId: string | null) {
  if (launched?.schedule.id !== scheduleId) return;
  if (noteId) launched.noteId = noteId;
  else {
    snapshot = { ...snapshot, missed: [...snapshot.missed, launched.schedule.startAt] };
    launched = null; emit();
  }
  recheck?.();
}
/** Start only after storage and the root navigator are ready. Idempotent. */
export function startScheduledStartWatcher(pipeline: Pick<Pipeline, 'subscribe' | 'stopRecording'>) {
  if (stopWatcher) return stopWatcher;
  let live: LiveSessionState | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checking = false;
  let disposed = false;
  const requestCheck = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { void check(); }, 0);
  };
  const consume = (schedule: ScheduledStart, missed: boolean) => {
    revision++;
    snapshot = { schedules: snapshot.schedules.filter(item => item.id !== schedule.id),
      missed: missed ? [...snapshot.missed, schedule.startAt] : snapshot.missed };
    void persist(snapshot.schedules); emit();
  };
  const check = async () => {
    if (checking || disposed) return;
    checking = true;
    clearTimeout(timer);
    try {
      while (!disposed) {
        const schedule = snapshot.schedules[0];
        if (!schedule) return;
        const remaining = schedule.startAt - Date.now();
        if (remaining > 0) {
          timer = setTimeout(() => { void check(); }, Math.min(remaining, MAX_DELAY));
          return;
        }
        if (-remaining > 10 * 60_000 || (schedule.stopAt !== null && schedule.stopAt <= Date.now())) {
          consume(schedule, true); continue;
        }
        if (live && launched?.noteId === live.noteId && launched.stopAt !== null && launched.stopAt <= schedule.startAt) {
          try { await pipeline.stopRecording(); } catch { /* A failed stop remains live and blocks this start. */ }
          if (disposed) return;
          if (!snapshot.schedules.some(item => item.id === schedule.id)) continue;
          if (!live) {
            // Let the finishing record screen navigate away before opening a fresh one.
            requestCheck(); return;
          }
        }
        if (live || (launched && !launched.noteId)) { consume(schedule, true); continue; }
        consume(schedule, false);
        launched = { schedule, noteId: null, stopAt: schedule.stopAt };
        router.navigate({ pathname: '/record', params: { scheduleId: schedule.id,
          ...(schedule.stopAt !== null ? { stopAt: String(schedule.stopAt) } : {}) } });
      }
    } finally { checking = false; }
  };
  const unsubscribe = pipeline.subscribe(state => {
    live = state;
    if (!state && launched?.noteId) launched = null;
    else if (state && launched?.noteId === state.noteId && (state.state === 'recording' || state.state === 'paused')) {
      launched.stopAt = state.stopAt;
    }
    requestCheck();
  });
  recheck = requestCheck;
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  const appState = AppState.addEventListener('change', state => { if (state === 'active') void check(); });
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  stopWatcher = () => {
    disposed = true; clearTimeout(timer); unsubscribe(); appState.remove();
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    recheck = null; stopWatcher = null; launched = null;
  };
  void check();
  return stopWatcher;
}

/** Next local occurrence, using calendar arithmetic across DST changes. */
export function nextScheduleTime(time: string, after: number): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [hours, minutes] = time.split(':').map(Number);
  const date = new Date(after);
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= after) date.setDate(date.getDate() + 1);
  return date.getTime();
}

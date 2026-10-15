import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { router } from 'expo-router';
import type { Pipeline } from '../pipeline/types';

export type ScheduledStart = { startAt: number; stopAt: number | null };
const KEY = 'voicenote.scheduledStart';
const MAX_DELAY = 2 ** 31 - 1;
let snapshot: { schedule: ScheduledStart | null; missed: boolean } = { schedule: null, missed: false };
const listeners = new Set<() => void>();
let revision = 0;
let writes = Promise.resolve();
let recheck: (() => void) | null = null;
let stopWatcher: (() => void) | null = null;
const emit = () => listeners.forEach(listener => listener());
export const getScheduledStart = () => snapshot;
export function subscribeScheduledStart(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useScheduledStart() {
  return useSyncExternalStore(subscribeScheduledStart, getScheduledStart, getScheduledStart);
}
function valid(value: unknown): value is ScheduledStart {
  if (!value || typeof value !== 'object') return false;
  const { startAt, stopAt } = value as ScheduledStart;
  return typeof startAt === 'number' && Number.isFinite(startAt) && startAt > 0 && startAt <= 8.64e15
    && (stopAt === null || (typeof stopAt === 'number' && Number.isFinite(stopAt) && stopAt > startAt && stopAt <= 8.64e15));
}
function persist(schedule: ScheduledStart | null) {
  // Serialize writes so a slow set cannot resurrect a canceled schedule.
  writes = writes.then(async () => {
    try {
      if (schedule) await AsyncStorage.setItem(KEY, JSON.stringify(schedule));
      else await AsyncStorage.removeItem(KEY);
    } catch { /* Storage unavailable: retain in-memory behavior. */ }
  });
  return writes;
}
export async function loadScheduledStart() {
  const version = revision;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (version !== revision) return;
    const value: unknown = raw ? JSON.parse(raw) : null;
    snapshot = { ...snapshot, schedule: valid(value) ? value : null };
    emit();
    recheck?.();
  } catch { /* Keep the in-memory schedule. */ }
}
export function setScheduledStart(schedule: ScheduledStart) {
  if (!valid(schedule)) throw new Error('Invalid recording schedule');
  revision++;
  snapshot = { schedule: { ...schedule }, missed: false };
  const saved = persist(snapshot.schedule);
  emit();
  recheck?.();
  return saved;
}
export function clearScheduledStart() {
  revision++;
  snapshot = { ...snapshot, schedule: null };
  const saved = persist(null);
  emit();
  recheck?.();
  return saved;
}
export function dismissMissedStart() {
  snapshot = { ...snapshot, missed: false };
  emit();
}
/** Start only after storage and the root navigator are ready. Idempotent. */
export function startScheduledStartWatcher(pipeline: Pick<Pipeline, 'subscribe'>) {
  if (stopWatcher) return stopWatcher;
  let live = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = pipeline.subscribe(state => { live = !!state; });
  const check = () => {
    clearTimeout(timer);
    const schedule = snapshot.schedule;
    if (!schedule) return;
    const remaining = schedule.startAt - Date.now();
    if (remaining > 0) {
      timer = setTimeout(check, Math.min(remaining, MAX_DELAY));
      return;
    }
    const missed = -remaining > 10 * 60_000;
    snapshot = { ...snapshot, missed };
    void clearScheduledStart();
    if (!missed && !live) router.navigate({ pathname: '/record', params: schedule.stopAt ? { stopAt: String(schedule.stopAt) } : {} });
  };
  recheck = check;
  const onVisible = () => { if (document.visibilityState === 'visible') check(); };
  const appState = AppState.addEventListener('change', state => { if (state === 'active') check(); });
  if (Platform.OS === 'web' && typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  stopWatcher = () => {
    clearTimeout(timer);
    unsubscribe();
    appState.remove();
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    recheck = null;
    stopWatcher = null;
  };
  check();
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

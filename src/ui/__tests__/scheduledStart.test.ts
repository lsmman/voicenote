import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import type { LiveSessionState, Pipeline } from '../../pipeline/types';
import { clearScheduledStart, dismissMissedStart, getScheduledStart, loadScheduledStart, nextScheduleTime, setScheduledStart, startScheduledStartWatcher, subscribeScheduledStart } from '../scheduledStart';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
const KEY = 'voicenote.scheduledStart';
const NOW = new Date('2026-10-15T12:00:00Z').getTime();
let stop: (() => void) | undefined;
let foreground: (state: AppStateStatus) => void;
function watch(initial: LiveSessionState | null = null) {
  let emit!: (state: LiveSessionState | null) => void;
  const pipeline: Pick<Pipeline, 'subscribe'> = { subscribe: listener => { emit = listener; listener(initial); return jest.fn(); } };
  stop = startScheduledStartWatcher(pipeline);
  return { emit, pipeline };
}
beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  await clearScheduledStart();
  dismissMissedStart();
  await AsyncStorage.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener;
    return { remove: jest.fn() };
  });
});
afterEach(async () => { stop?.(); stop = undefined; await clearScheduledStart(); jest.restoreAllMocks(); jest.useRealTimers(); });
test('fires once, clears persisted schedule and forwards end time', async () => {
  const schedule = { startAt: NOW + 1000, stopAt: NOW + 60000 };
  await setScheduledStart(schedule);
  watch();
  jest.advanceTimersByTime(1000);
  foreground('active');
  expect(router.navigate).toHaveBeenCalledTimes(1);
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/record', params: { stopAt: String(schedule.stopAt) } });
  expect(getScheduledStart().schedule).toBeNull();
  await Promise.resolve();
  await Promise.resolve();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});
test('late foreground beyond ten minutes clears and exposes a dismissible missed notice', async () => {
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  watch();
  jest.setSystemTime(NOW + 601001);
  foreground('active');
  expect(router.navigate).not.toHaveBeenCalled();
  expect(getScheduledStart()).toEqual({ schedule: null, missed: true });
  dismissMissedStart();
  expect(getScheduledStart().missed).toBe(false);
});
test('foreground within ten minutes starts without an end time', async () => {
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  watch();
  jest.setSystemTime(NOW + 601000);
  foreground('active');
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/record', params: {} });
});
test('cancel removes timer and persisted schedule', async () => {
  watch();
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  await clearScheduledStart();
  jest.advanceTimersByTime(2000);
  expect(router.navigate).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(KEY)).toBeNull();
});
test('restores a persisted schedule before starting the watcher', async () => {
  const schedule = { startAt: NOW + 1000, stopAt: null };
  await AsyncStorage.setItem(KEY, JSON.stringify(schedule));
  await loadScheduledStart();
  expect(getScheduledStart().schedule).toEqual(schedule);
  watch();
  jest.advanceTimersByTime(1000);
  expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('skips when a recording becomes live before the deadline', async () => {
  const { emit } = watch();
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  emit({ noteId: 'live', state: 'recording' } as LiveSessionState);
  jest.advanceTimersByTime(1000);
  expect(router.navigate).not.toHaveBeenCalled();
  expect(getScheduledStart().schedule).toBeNull();
});
test('re-arms delays larger than the timer limit', async () => {
  const max = 2 ** 31 - 1;
  await setScheduledStart({ startAt: NOW + max + 1000, stopAt: null });
  watch();
  jest.advanceTimersByTime(max);
  expect(router.navigate).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1000);
  expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('storage failures retain in-memory scheduling', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage'));
  (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('storage'));
  watch();
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  jest.advanceTimersByTime(1000);
  expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('a slow load cannot overwrite a newer schedule', async () => {
  let resolve!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const loading = loadScheduledStart();
  const schedule = { startAt: NOW + 5000, stopAt: null };
  await setScheduledStart(schedule);
  resolve(JSON.stringify({ startAt: NOW + 1000, stopAt: null }));
  await loading;
  expect(getScheduledStart().schedule).toEqual(schedule);
});
test('invalid persisted data is ignored and subscribers can unsubscribe', async () => {
  const listener = jest.fn();
  const unsubscribe = subscribeScheduledStart(listener);
  await AsyncStorage.setItem(KEY, '{"startAt":"bad","stopAt":null}');
  await loadScheduledStart();
  expect(getScheduledStart().schedule).toBeNull();
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  await clearScheduledStart();
  expect(listener).toHaveBeenCalledTimes(1);
});
test('clock input validates and rolls to the next local day', () => {
  const start = new Date(2026, 9, 15, 23, 30).getTime();
  expect(nextScheduleTime('24:00', start)).toBeNull();
  expect(nextScheduleTime('1:00', start)).toBeNull();
  expect(nextScheduleTime('00:15', start)).toBe(new Date(2026, 9, 16, 0, 15).getTime());
});

test('web visibility rechecks a suspended timer and cleanup removes listeners', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousOS = Platform.OS;
  let visible!: () => void;
  const removeEventListener = jest.fn();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    visibilityState: 'visible',
    addEventListener: jest.fn((_event, listener) => { visible = listener; }),
    removeEventListener,
  } });
  Platform.OS = 'web';
  try {
    await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
    const { pipeline } = watch();
    expect(startScheduledStartWatcher(pipeline)).toBe(stop);
    jest.setSystemTime(NOW + 2000);
    visible();
    expect(router.navigate).toHaveBeenCalledTimes(1);
    stop?.(); stop = undefined;
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', visible);
  } finally {
    stop?.(); stop = undefined;
    Platform.OS = previousOS;
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
test('an already live recording is skipped and a replacement cancels the old timer', async () => {
  await setScheduledStart({ startAt: NOW + 1000, stopAt: null });
  watch({ noteId: 'live', state: 'paused' } as LiveSessionState);
  await setScheduledStart({ startAt: NOW + 2000, stopAt: null });
  jest.advanceTimersByTime(1000);
  expect(getScheduledStart().schedule?.startAt).toBe(NOW + 2000);
  jest.advanceTimersByTime(1000);
  expect(router.navigate).not.toHaveBeenCalled();
  expect(getScheduledStart().schedule).toBeNull();
});

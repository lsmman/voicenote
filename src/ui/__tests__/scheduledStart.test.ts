import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { router } from 'expo-router';
import type { LiveSessionState, Pipeline } from '../../pipeline/types';
import { addScheduledStart, completeScheduledRecordingStart, dismissMissedStart, getScheduledStart, loadScheduledStart, nextScheduleTime, removeScheduledStart, startScheduledStartWatcher, subscribeScheduledStart } from '../scheduledStart';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
const KEY = 'voicenote.scheduledStarts';
const OLD_KEY = 'voicenote.scheduledStart';
const NOW = new Date('2026-10-15T12:00:00Z').getTime();
let stop: (() => void) | undefined;
let foreground: (state: AppStateStatus) => void;
const schedules = () => getScheduledStart().schedules;
const live = (stopAt: number | null = null) => ({ noteId: 'live', state: 'recording', stopAt } as LiveSessionState);
function add(start: number, end: number | null = null) {
  expect(addScheduledStart({ startAt: NOW + start, stopAt: end === null ? null : NOW + end })).toBeNull();
  return schedules().find(item => item.startAt === NOW + start)!;
}
function watch(initial: LiveSessionState | null = null) {
  let emit!: (state: LiveSessionState | null) => void;
  const pipeline: Pick<Pipeline, 'subscribe' | 'stopRecording'> = {
    subscribe: listener => { emit = listener; listener(initial); return jest.fn(); },
    stopRecording: jest.fn(async () => { emit(null); }),
  };
  stop = startScheduledStartWatcher(pipeline);
  return { emit, pipeline };
}
async function clear() { for (const item of schedules()) await removeScheduledStart(item.id); }
beforeEach(async () => {
  jest.useFakeTimers(); jest.setSystemTime(NOW); jest.clearAllMocks();
  await clear(); dismissMissedStart(); await AsyncStorage.clear();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    foreground = listener; return { remove: jest.fn() };
  });
});
afterEach(async () => { stop?.(); stop = undefined; await clear(); jest.restoreAllMocks(); jest.useRealTimers(); });

test('multiple schedules fire in sorted order, once, forwarding stop times', async () => {
  const second = add(121000, 181000); const first = add(1000, 61000);
  const { emit } = watch();
  jest.advanceTimersByTime(1000);
  expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/record', params: { scheduleId: first.id, stopAt: String(first.stopAt) } });
  emit(live(first.stopAt)); completeScheduledRecordingStart(first.id, 'live');
  emit(null);
  jest.advanceTimersByTime(120000);
  foreground('active');
  expect(router.navigate).toHaveBeenCalledTimes(2);
  expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/record', params: { scheduleId: second.id, stopAt: String(second.stopAt) } });
  expect(schedules()).toEqual([]);
  await loadScheduledStart();
  expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual([]);
});
test('removes one item and re-arms the next timer, preserving it in storage', async () => {
  const first = add(1000); const second = add(121000);
  watch(); await removeScheduledStart(first.id);
  jest.advanceTimersByTime(1000); expect(router.navigate).not.toHaveBeenCalled();
  expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual([second]);
  jest.advanceTimersByTime(120000); expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('rejects overlapping windows in both directions but permits adjoining endpoints', () => {
  add(61000, 121000);
  for (const [startAt, stopAt] of [[61000, null], [90000, 180000], [1000, 180000], [1000, 62000]]) {
    expect(addScheduledStart({ startAt: NOW + startAt!, stopAt: stopAt === null ? null : NOW + stopAt! })).toBe('overlap');
  }
  add(1000, 61000); add(121000, 181000);
});
test('a schedule without stop occupies one minute, including when the new window starts earlier', () => {
  add(61000);
  expect(addScheduledStart({ startAt: NOW + 120999, stopAt: null })).toBe('overlap');
  expect(addScheduledStart({ startAt: NOW + 1000, stopAt: NOW + 61001 })).toBe('overlap');
  add(121000);
});
test('validates future start, end and maximum count', () => {
  for (const item of [{ startAt: NOW, stopAt: null }, { startAt: NaN, stopAt: null }, { startAt: NOW + 1000, stopAt: NOW + 1000 }]) {
    expect(addScheduledStart(item)).toBe('invalidTime');
  }
  for (let i = 0; i < 20; i++) add(1000 + i * 60000);
  expect(addScheduledStart({ startAt: NOW + 2000000, stopAt: null })).toBe('tooMany');
});
test('migrates the old single value once, removes its key and restores the new list', async () => {
  const old = { startAt: NOW + 1000, stopAt: null };
  await AsyncStorage.setItem(OLD_KEY, JSON.stringify(old));
  await loadScheduledStart();
  expect(schedules()).toEqual([{ ...old, id: expect.any(String) }]);
  const migrated = schedules();
  expect(await AsyncStorage.getItem(OLD_KEY)).toBeNull();
  expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual(migrated);
  await AsyncStorage.setItem(OLD_KEY, JSON.stringify({ ...old, startAt: NOW + 900000 }));
  await loadScheduledStart(); expect(schedules()).toEqual(migrated);
  expect(await AsyncStorage.getItem(OLD_KEY)).toBeNull();
});
test('restores and sorts persisted schedules', async () => {
  const items = [{ id: 'b', startAt: NOW + 121000, stopAt: null }, { id: 'a', startAt: NOW + 1000, stopAt: null }];
  await AsyncStorage.setItem(KEY, JSON.stringify(items)); await loadScheduledStart();
  expect(schedules()).toEqual([items[1], items[0]]);
});
test('reports multiple overdue schedules once and keeps future items', () => {
  add(1000); add(61000); const future = add(900000); watch();
  jest.setSystemTime(NOW + 700000); foreground('active'); foreground('active');
  expect(schedules()).toEqual([future]);
  expect(getScheduledStart().missed).toEqual([NOW + 1000, NOW + 61000]);
  dismissMissedStart(); foreground('active'); expect(getScheduledStart().missed).toEqual([]);
});
test('starts at the ten-minute boundary but skips an already expired end', () => {
  const first = add(1000); watch(); jest.setSystemTime(NOW + 601000); foreground('active');
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/record', params: { scheduleId: first.id } });
});
test('expired recording window is missed even within ten minutes', () => {
  add(1000, 2000); watch(); jest.setSystemTime(NOW + 3000); foreground('active');
  expect(router.navigate).not.toHaveBeenCalled(); expect(getScheduledStart().missed).toEqual([NOW + 1000]);
});
test('manual live recordings are skipped and reported, never stopped', () => {
  add(1000); const { pipeline } = watch(live(NOW + 1000)); jest.advanceTimersByTime(1000);
  expect(router.navigate).not.toHaveBeenCalled(); expect(pipeline.stopRecording).not.toHaveBeenCalled();
  expect(getScheduledStart().missed).toEqual([NOW + 1000]);
});
test('adjacent schedules await the previous scheduled stop before navigating', async () => {
  const first = add(1000, 61000); const second = add(61000, 121000);
  const { emit, pipeline } = watch(); jest.advanceTimersByTime(1000);
  emit(live(first.stopAt)); completeScheduledRecordingStart(first.id, 'live');
  let finish!: () => void;
  (pipeline.stopRecording as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { finish = () => { emit(null); resolve(); }; }));
  jest.advanceTimersByTime(60000);
  expect(pipeline.stopRecording).toHaveBeenCalledTimes(1); expect(router.navigate).toHaveBeenCalledTimes(1);
  finish(); await Promise.resolve(); jest.advanceTimersByTime(1);
  expect(router.navigate).toHaveBeenCalledTimes(2);
  expect(router.navigate).toHaveBeenLastCalledWith({ pathname: '/record', params: { scheduleId: second.id, stopAt: String(second.stopAt) } });
  expect(getScheduledStart().missed).toEqual([]);
});
test('a failed stop skips the next schedule instead of opening a second recording', async () => {
  const first = add(1000, 61000); add(61000, 121000);
  const { emit, pipeline } = watch(); jest.advanceTimersByTime(1000);
  emit(live(first.stopAt)); completeScheduledRecordingStart(first.id, 'live');
  (pipeline.stopRecording as jest.Mock).mockRejectedValue(new Error('disk'));
  jest.advanceTimersByTime(60000); await Promise.resolve();
  expect(router.navigate).toHaveBeenCalledTimes(1); expect(getScheduledStart().missed).toEqual([NOW + 61000]);
});
test('canceled or extended stop does not stop a live recording for the next schedule', () => {
  const first = add(1000, 61000); add(61000, 121000);
  const { emit, pipeline } = watch(); jest.advanceTimersByTime(1000);
  completeScheduledRecordingStart(first.id, 'live'); emit(live(null)); jest.advanceTimersByTime(60000);
  expect(pipeline.stopRecording).not.toHaveBeenCalled(); expect(getScheduledStart().missed).toEqual([NOW + 61000]);
});
test('navigation in progress blocks another due item and start failure is reported', () => {
  const first = add(1000); add(61000); watch(); jest.advanceTimersByTime(61000);
  expect(router.navigate).toHaveBeenCalledTimes(1);
  completeScheduledRecordingStart(first.id, null);
  expect(getScheduledStart().missed).toEqual([NOW + 61000, NOW + 1000]);
});
test('re-arms delays larger than the timer limit', () => {
  const max = 2 ** 31 - 1; add(max + 1000); watch(); jest.advanceTimersByTime(max);
  expect(router.navigate).not.toHaveBeenCalled(); jest.advanceTimersByTime(1000); expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('storage failure retains in-memory scheduling', async () => {
  (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage'));
  add(1000); watch(); jest.advanceTimersByTime(1000); expect(router.navigate).toHaveBeenCalledTimes(1);
});
test('slow load cannot overwrite an added item', async () => {
  let resolve!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const loading = loadScheduledStart(); await Promise.resolve();
  const item = add(5000); resolve('[]'); await loading; expect(schedules()).toEqual([item]);
});
test('invalid persisted data is ignored and subscribers unsubscribe', async () => {
  const listener = jest.fn(); const unsubscribe = subscribeScheduledStart(listener);
  await AsyncStorage.setItem(KEY, '[{"startAt":"bad","stopAt":null}]'); await loadScheduledStart();
  expect(schedules()).toEqual([]); expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe(); add(1000); expect(listener).toHaveBeenCalledTimes(1);
});
test('clock input validates and rolls to the next local day', () => {
  const start = new Date(2026, 9, 15, 23, 30).getTime();
  expect(nextScheduleTime('24:00', start)).toBeNull(); expect(nextScheduleTime('1:00', start)).toBeNull();
  expect(nextScheduleTime('00:15', start)).toBe(new Date(2026, 9, 16, 0, 15).getTime());
});
test('web visibility rechecks suspended timer and cleanup removes listeners', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'); const previousOS = Platform.OS;
  let visible!: () => void; const removeEventListener = jest.fn();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    visibilityState: 'visible', addEventListener: jest.fn((_event, listener) => { visible = listener; }), removeEventListener,
  } });
  Platform.OS = 'web';
  try {
    add(1000); const { pipeline } = watch(); expect(startScheduledStartWatcher(pipeline)).toBe(stop);
    jest.setSystemTime(NOW + 2000); visible(); expect(router.navigate).toHaveBeenCalledTimes(1);
    stop?.(); stop = undefined; expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', visible);
  } finally {
    stop?.(); stop = undefined; Platform.OS = previousOS;
    if (previous) Object.defineProperty(globalThis, 'document', previous); else Reflect.deleteProperty(globalThis, 'document');
  }
});

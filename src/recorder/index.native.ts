import { AppState, Platform } from 'react-native';
import { AudioModule, AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync,
  setAudioModeAsync, type RecordingOptions } from 'expo-audio';
import { createRecordingOptions } from 'expo-audio/build/utils/options';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { bounded, createRecorder, type CapturedAudio, type Capture, type Driver } from './runtime';
import { mp4DurationMs } from './duration';
import { dbToLevel } from './timeline';
import type { RecorderWarning } from './types';

// SDK 57: Audio.types.d.ts RecordingOptions; pass options explicitly to prepare
// because ExpoAudio.js normalizes the platform-specific fields at that boundary.
const options: RecordingOptions = {
  directory: 'document', extension: '.m4a', sampleRate: 16_000,
  numberOfChannels: 1, bitRate: 48_000, isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: {},
};
const wakeTag = 'voicenote-recorder';
let warn: (warning: RecorderWarning) => void = () => {};
let canPrepareAhead = true;
let selectedOptions = options;
let statusTick: (() => void) | undefined;

async function prepareWith(config: RecordingOptions): Promise<Capture> {
  // The imperative constructor expects flattened native options, just as the
  // SDK's useAudioRecorder implementation does (utils/options.d.ts).
  const native = new AudioModule.AudioRecorder(createRecordingOptions(config));
  let stopped = false;
  let released = false;
  let durationMs = 0;
  let uri: string | null = null;
  let interruption: string | undefined;
  // No hooks: SharedObject's typed event subscription provides error details that
  // getStatus() does not contain (AudioModule.types.d.ts RecordingEvents).
  const subscription = native.addListener('recordingStatusUpdate', (status) => {
    if (stopped) return;
    uri ??= status.url;
    if (status.hasError || status.mediaServicesDidReset || status.isFinished) {
      interruption = status.error || 'Native recording stopped or media services reset';
    }
    statusTick?.();
  });
  try { await bounded(native.prepareToRecordAsync(config), 'native prepare'); }
  catch (error) { subscription.remove(); native.release(); throw error; }
  let persistedPath: string | undefined;
  function salvage(): CapturedAudio {
    const source = uri ? new File(uri) : null;
    return {
      durationMs,
      mimeType: 'audio/mp4',
      async persist(noteId, seq) {
        if (persistedPath) return persistedPath;
        if (!source?.exists) throw new Error('Recording file missing after stop');
        const directory = new Directory(Paths.document, 'recordings', noteId);
        directory.create({ intermediates: true, idempotent: true });
        const destination = new File(directory, `${seq}.m4a`);
        if (destination.exists) throw new Error(`Recording chunk already exists: ${noteId}/${seq}`);
        await source.move(destination);
        persistedPath = `recordings/${noteId}/${seq}.m4a`;
        return persistedPath;
      },
      async discard() { if (source?.exists) source.delete(); },
    };
  }
  return {
    salvage,
    start() {
      native.record();
      const status = native.getStatus();
      if (!status.isRecording) throw new Error('Native recorder did not start');
      uri = status.url ?? native.uri;
    },
    sample() {
      try {
        const status = native.getStatus();
        durationMs = Math.max(durationMs, status.durationMillis);
        uri ??= status.url ?? native.uri;
        return {
          durationMs,
          level: status.metering === undefined ? undefined : dbToLevel(status.metering),
          interrupted: interruption ?? (!status.isRecording || !status.canRecord || status.mediaServicesDidReset
            ? 'Native recording interrupted' : undefined),
        };
      } catch (error) { return { durationMs, interrupted: String(error) }; }
    },
    async stop() {
      // Read duration BEFORE stop: iOS resets duration tracking when stopped.
      try {
        const status = native.getStatus();
        durationMs = Math.max(durationMs, status.durationMillis);
        uri ??= status.url ?? native.uri;
      } catch { /* A reset can invalidate status; retain the last observed values. */ }
      stopped = true;
      try { await bounded(native.stop(), 'native stop'); }
      catch (error) {
        warn({ kind: 'interrupted', reason: `Native stop: ${String(error)}` });
      }
      // A media-services reset may replace the SDK recorder's file. Keep the
      // original capture URI so a newly prepared empty file cannot replace it.
      try { uri ??= native.uri; } catch { /* Retain the last URI after a media reset. */ }
      const source = uri ? new File(uri) : null;
      if (!source?.exists) warn({ kind: 'interrupted', reason: `Recording file missing after stop; retained ${durationMs}ms` });
      else {
        try {
          const measured = mp4DurationMs(await bounded(source.arrayBuffer(), 'file duration'));
          if (measured !== undefined) durationMs = measured;
        } catch { /* Retain the recorder's last observed duration if metadata is unavailable. */ }
      }
      return salvage();
    },
    async dispose() {
      if (released) return;
      released = true;
      subscription.remove();
      // release must not await a second potentially hung stop().
      native.release();
    },
  };
}

const driver: Driver = {
  async open(onWarning) {
    warn = onWarning; canPrepareAhead = true; selectedOptions = options;
    if (!(await requestRecordingPermissionsAsync()).granted) throw new Error('Microphone permission denied');
    // SDK 57 Android background recorder requires notification permission before prepare.
    if (Platform.OS === 'android' && !(await AudioModule.requestNotificationPermissionsAsync()).granted) {
      throw new Error('Notification permission required for background recording');
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true,
      allowsBackgroundRecording: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
  },
  async prepare() {
    try { return await prepareWith(selectedOptions); }
    catch (error) {
      if (selectedOptions.sampleRate !== 16_000 || String(error).includes('timed out')) throw error;
      // Some hardware encoders reject 16 kHz; retain mono AAC at the fallback rate.
      const fallback = { ...options, sampleRate: 44_100, bitRate: 64_000 };
      const capture = await prepareWith(fallback);
      selectedOptions = fallback;
      return capture;
    }
  },
  async prepareAhead() {
    if (!canPrepareAhead) return null;
    try { return await prepareWith(selectedOptions); }
    catch (error) {
      if (String(error).includes('timed out')) warn({ kind: 'interrupted', reason: String(error) });
      // Multiple instances are constructible, but .d.ts promises no concurrent
      // microphone preparation or gapless handover across devices.
      canPrepareAhead = false;
      return null;
    }
  },
  subscribe(tick) {
    statusTick = tick;
    // AudioModule.types.d.ts RecordingEvents.recordingStatusUpdate is a status-change
    // event, not a guaranteed periodic timer. Use every delivered event plus AppState.
    // UIBackgroundModes=audio + an active recording session are required on iOS.
    // Unverified: installed expo-audio docs/comments do NOT guarantee that iOS keeps
    // JS running while locked. These wakeups supplement, not guarantee, JS rotation.
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') tick(); });
    return () => { statusTick = undefined; subscription.remove(); };
  },
  awake: (active) => active ? activateKeepAwakeAsync(wakeTag) : deactivateKeepAwake(wakeTag),
  async close() {
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
  },
  freeBytes: () => Paths.availableDiskSpace,
};

export const recorder = createRecorder(driver);

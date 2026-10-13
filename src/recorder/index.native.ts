import { Platform } from 'react-native';
import { AudioModule, AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync,
  setAudioModeAsync, type RecordingOptions } from 'expo-audio';
import { createRecordingOptions } from 'expo-audio/build/utils/options';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { createRecorder, type Capture, type Driver } from './runtime';
import { dbToLevel } from './timeline';
import type { Recorder, RecorderWarning } from './types';

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
  });
  try { await native.prepareToRecordAsync(config); }
  catch (error) { subscription.remove(); native.release(); throw error; }
  return {
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
          level: status.metering === undefined ? undefined : dbToLevel(status.metering),
          interrupted: interruption ?? (!status.isRecording || !status.canRecord || status.mediaServicesDidReset
            ? 'Native recording interrupted' : undefined),
        };
      } catch (error) { return { interrupted: String(error) }; }
    },
    async stop() {
      // Read duration BEFORE stop: iOS resets duration tracking when stopped.
      try {
        const status = native.getStatus();
        durationMs = Math.max(durationMs, status.durationMillis);
        uri ??= status.url ?? native.uri;
      } catch { /* A reset can invalidate status; retain the last observed values. */ }
      stopped = true;
      try { await native.stop(); }
      catch (error) {
        warn({ kind: 'interrupted', reason: `Native stop: ${String(error)}` });
      }
      // A media-services reset may replace the SDK recorder's file. Keep the
      // original capture URI so a newly prepared empty file cannot replace it.
      try { uri ??= native.uri; } catch { /* Retain the last URI after a media reset. */ }
      const source = uri ? new File(uri) : null;
      return {
        durationMs: source?.exists ? durationMs : 0,
        mimeType: 'audio/mp4',
        async persist(noteId, seq) {
          if (!source?.exists) throw new Error('Recording file missing after stop');
          const directory = new Directory(Paths.document, 'recordings', noteId);
          directory.create({ intermediates: true, idempotent: true });
          const destination = new File(directory, `${seq}.m4a`);
          if (destination.exists) throw new Error(`Recording chunk already exists: ${noteId}/${seq}`);
          await source.move(destination);
          return destination.uri;
        },
        async discard() { if (source?.exists) source.delete(); },
      };
    },
    async dispose() {
      if (released) return;
      released = true;
      subscription.remove();
      try { if (!stopped) await native.stop(); }
      finally { native.release(); }
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
      if (selectedOptions.sampleRate !== 16_000) throw error;
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
    catch {
      // Multiple instances are constructible, but .d.ts promises no concurrent
      // microphone preparation or gapless handover across devices.
      canPrepareAhead = false;
      return null;
    }
  },
  awake: (active) => active ? activateKeepAwakeAsync(wakeTag) : deactivateKeepAwake(wakeTag),
  async close() {
    await setAudioModeAsync({ allowsRecording: false, allowsBackgroundRecording: false, shouldPlayInBackground: false });
  },
  freeBytes: () => Paths.availableDiskSpace,
};

export const recorder: Recorder = createRecorder(driver);

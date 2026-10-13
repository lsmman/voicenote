import { store } from '../store';
import { bounded, createRecorder, type CapturedAudio, type Capture, type Driver } from './runtime';
import type { RecorderWarning } from './types';

const mimeTypes = ['audio/webm;codecs=opus', 'audio/mp4'];
let stream: MediaStream | null = null;
let context: AudioContext | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;
let samples: Float32Array<ArrayBuffer> | null = null;
let mimeType = '';
let warn: (warning: RecorderWarning) => void = () => {};
let wake: WakeLockSentinel | null = null;
let wantsWake = false;
let wakeGeneration = 0;
let requestingWake = false;
let trackCleanup: (() => void)[] = [];

async function acquireWake() {
  if (requestingWake || wake || !wantsWake || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  const generation = wakeGeneration;
  requestingWake = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!wantsWake || generation !== wakeGeneration) { await lock.release(); return; }
    wake = lock;
    lock.addEventListener('release', () => { if (wake === lock) wake = null; });
  } catch (error) { console.debug('Screen wake lock unavailable', error); }
  finally { requestingWake = false; }
}
function visibilityChanged() { void acquireWake(); }

const driver: Driver = {
  async open(onWarning) {
    warn = onWarning;
    if (!store.putAudioBlob) throw new Error('Web recorder requires store.putAudioBlob');
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Audio recording is not supported in this browser');
    }
    mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
    if (!mimeType) throw new Error('Browser supports neither Opus WebM nor audio MP4 recording');
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16_000 }, video: false });
    for (const track of stream.getAudioTracks()) {
      const ended = () => warn({ kind: 'mic-ended' });
      const muted = () => warn({ kind: 'interrupted', reason: 'Microphone track muted' });
      track.addEventListener('ended', ended);
      track.addEventListener('mute', muted);
      trackCleanup.push(() => { track.removeEventListener('ended', ended); track.removeEventListener('mute', muted); });
    }
    context = new AudioContext();
    await context.resume();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    samples = new Float32Array(analyser.fftSize);
    source = context.createMediaStreamSource(stream);
    source.connect(analyser); // Never connect the microphone to speakers.
    document.addEventListener('visibilitychange', visibilityChanged);
  },
  async prepare(): Promise<Capture> {
    if (!stream || stream.getAudioTracks().every(track => track.readyState === 'ended')) {
      throw new Error('Microphone stream has ended; start a new recording to request access again');
    }
    const media = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 48_000 });
    const slices: Blob[] = [];
    let startedAt = 0;
    let audioStartedAt = 0;
    let capturedMs = 0;
    let finalDurationMs = 0;
    let started = false;
    let endedAt: number | null = null;
    let failure: string | undefined;
    let stopping: Promise<void> | null = null;
    let resolveStopped!: () => void;
    const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });
    media.ondataavailable = event => {
      if (event.data.size) slices.push(event.data);
      if (Number.isFinite(event.timecode)) capturedMs = Math.max(capturedMs, event.timecode);
    };
    media.onstop = () => { endedAt ??= Date.now(); resolveStopped(); };
    media.onerror = () => { failure = 'MediaRecorder error'; };
    async function halt() {
      if (!stopping) {
        endedAt ??= Date.now();
        finalDurationMs = capturedMs || (context && Number.isFinite(context.currentTime)
          ? Math.max(0, (context.currentTime - audioStartedAt) * 1000)
          : Math.max(0, endedAt - startedAt));
        if (media.state !== 'inactive') { media.stop(); stopping = stopped; }
        // An automatic stop queues final dataavailable BEFORE stop. Always wait
        // for that event if recording started, even when state is already inactive.
        else stopping = started ? stopped : Promise.resolve();
      }
      await stopping;
    }
    function salvage(): CapturedAudio {
      const blob = new Blob(slices, { type: media.mimeType || mimeType });
      return {
        durationMs: finalDurationMs, mimeType: blob.type,
        async persist(noteId, seq) {
          if (!blob.size) throw new Error('MediaRecorder returned an empty recording');
          if (!store.putAudioBlob) throw new Error('Web recorder requires store.putAudioBlob');
          const key = `${noteId}/${seq}`;
          await store.putAudioBlob(key, blob);
          return key;
        },
        async discard() {},
      };
    }
    return {
      salvage,
      start() { media.start(5000); started = true; startedAt = Date.now(); audioStartedAt = context?.currentTime ?? 0; },
      sample() {
        let level: number | undefined;
        if (analyser && samples && context?.state === 'running') {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          level = Math.min(1, Math.sqrt(sum / samples.length));
        }
        return { level, durationMs: context && Number.isFinite(context.currentTime) ? Math.max(capturedMs, (context.currentTime - audioStartedAt) * 1000) : undefined, interrupted: failure ?? (media.state === 'inactive' ? 'MediaRecorder stopped unexpectedly' : undefined) };
      },
      async stop() {
        try { await bounded(halt(), 'web stop'); }
        catch (error) { warn({ kind: 'interrupted', reason: String(error) }); }
        const blob = new Blob(slices, { type: media.mimeType || mimeType });
        let durationMs = finalDurationMs;
        if (blob.size && context) {
          try {
            const decoded = await bounded(blob.arrayBuffer().then(bytes => context!.decodeAudioData(bytes)), 'blob duration');
            if (Number.isFinite(decoded.duration)) durationMs = decoded.duration * 1000;
          } catch { /* Browser codec support varies; retain capture time, wall time only as last fallback. */ }
        }
        finalDurationMs = durationMs;
        return salvage();
      },
      async dispose() {
        // Never wait for a missing stop event during forced cleanup.
        if (media.state !== 'inactive') { try { media.stop(); } catch { /* already lost */ } }
        media.ondataavailable = null; media.onstop = null; media.onerror = null;
      },
    };
  },
  async prepareAhead() { return driver.prepare(); },
  async awake(active) {
    wantsWake = active;
    if (active) await acquireWake();
    else {
      wakeGeneration++;
      const lock = wake; wake = null;
      await lock?.release();
    }
  },
  async close() {
    document.removeEventListener('visibilitychange', visibilityChanged);
    for (const remove of trackCleanup) remove();
    trackCleanup = [];
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    source?.disconnect(); source = null;
    analyser?.disconnect(); analyser = null; samples = null;
    const previousContext = context; context = null;
    if (previousContext && previousContext.state !== 'closed') await previousContext.close();
  },
};

export const recorder = createRecorder(driver);

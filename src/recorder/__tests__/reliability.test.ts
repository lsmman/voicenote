import { createRecorder, type Capture, type Driver } from '../runtime';

function fake() {
  let time = 0, duration = 900, failure = false, startFailure = false;
  let tick = () => {};
  const order: string[] = [];
  const persist = jest.fn(async () => 'file');
  const stop = jest.fn(async () => ({ durationMs: duration, mimeType: 'audio/mp4', persist, discard: async () => {} }));
  const dispose = jest.fn(async () => {});
  const capture: Capture = {
    start: () => { order.push('start'); if (startFailure) throw Error('busy'); },
    sample: () => { if (failure) throw Error('sample crashed'); return { durationMs: time }; }, stop, dispose,
  };
  const driver: Driver = {
    open: async () => {}, prepare: jest.fn(async () => ({ ...capture })),
    close: jest.fn(async () => {}), awake: async () => {},
    subscribe: cb => { tick = cb; return () => { tick = () => {}; }; },
  };
  const recorder = createRecorder(driver);
  const onChunk = jest.fn(), onWarning = jest.fn(), onElapsed = jest.fn();
  return { recorder, driver, capture, persist, stop, dispose, onChunk, onWarning, onElapsed,
    start: () => recorder.start('note', { onChunk, onWarning, onElapsed }),
    sampleTime: (value: number) => { time = value; }, duration: (value: number) => { duration = value; },
    fatal: () => { failure = true; }, failStart: () => { startFailure = true; }, tick: () => tick() };
}
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('capture time drives elapsed and rotation; finalized duration drives the next startMs', async () => {
  const f = fake(); await f.start();
  f.sampleTime(1200); await jest.advanceTimersByTimeAsync(120_000);
  expect(f.onElapsed).toHaveBeenLastCalledWith(1200);
  expect(f.stop).not.toHaveBeenCalled();
  f.duration(29_800); f.sampleTime(30_000); f.tick(); await flush();
  f.sampleTime(1000); await jest.advanceTimersByTimeAsync(100);
  expect(f.onElapsed).toHaveBeenLastCalledWith(30_800);
  await f.recorder.stop();
  expect(f.onChunk.mock.calls[1][0].startMs).toBe(29_800);
});

test('sequential fallback measures gap without interrupted warnings or timeline gaps', async () => {
  const f = fake(); await f.start();
  f.driver.prepareAhead = async () => ({ ...f.capture, start() { throw Error('concurrent capture refused'); } });
  f.driver.prepare = async () => { await new Promise(resolve => setTimeout(resolve, 250)); return f.capture; };
  f.sampleTime(30_000); await jest.advanceTimersByTimeAsync(350);
  expect(f.recorder.getDiagnostics().rotationGapMs).toBe(250);
  expect(f.onWarning).not.toHaveBeenCalled();
  f.sampleTime(0); await f.recorder.stop();
  expect(f.onChunk.mock.calls[1][0].startMs).toBe(900);
});

test('failed persistence retries with backoff without blocking capture or consuming another sequence', async () => {
  const f = fake(); f.persist.mockRejectedValueOnce(Error('disk busy')); await f.start();
  f.sampleTime(30_000); await jest.advanceTimersByTimeAsync(100); f.sampleTime(1000);
  expect(f.recorder.getState()).toBe('recording');
  expect(f.onChunk).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(999); expect(f.persist).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1); expect(f.onChunk.mock.calls[0][0].seq).toBe(0);
  expect(f.onWarning).not.toHaveBeenCalled(); await f.recorder.stop();
});

test('fatal sample errors stop and persist the active capture before disposal', async () => {
  const f = fake(); const order: string[] = [];
  f.persist.mockImplementation(async () => { order.push('persist'); return 'file'; });
  f.dispose.mockImplementation(async () => { order.push('dispose'); });
  await f.start(); f.fatal(); await jest.advanceTimersByTimeAsync(100);
  expect(f.stop).toHaveBeenCalledTimes(1);
  expect(f.onChunk).toHaveBeenCalledTimes(1);
  expect(order.indexOf('persist')).toBeLessThan(order.indexOf('dispose'));
  expect(f.recorder.getState()).toBe('idle');
  expect(f.recorder.getDiagnostics().error).toContain('sample crashed');
});

test('hung stop cannot freeze the serial chain and forces disposal with warning', async () => {
  const f = fake(); await f.start(); f.stop.mockImplementationOnce(() => new Promise(() => {}));
  const stopping = f.recorder.stop(); await jest.advanceTimersByTimeAsync(10_000); await stopping;
  expect(f.dispose).toHaveBeenCalled();
  expect(f.onWarning).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('stop timed out') }));
  await f.start(); await f.recorder.stop();
});

test('hung prepare times out and late completion is disposed, never started', async () => {
  const f = fake(); let complete!: (capture: Capture) => void;
  f.driver.prepare = () => new Promise(resolve => { complete = resolve; });
  const starting = f.start(); const rejected = expect(starting).rejects.toThrow('prepare timed out');
  await jest.advanceTimersByTimeAsync(10_000); await rejected;
  complete(f.capture); await flush(); expect(f.dispose).toHaveBeenCalled();
  expect(f.recorder.getState()).toBe('idle');
});

test('restart loop stops after 30 failures and exposes error without an infinite retry timer', async () => {
  const f = fake(); await f.start(); f.failStart();
  f.sampleTime(30_000); await jest.advanceTimersByTimeAsync(40_000);
  expect(f.recorder.getState()).toBe('idle');
  expect(f.onWarning).toHaveBeenCalledWith({ kind: 'mic-ended' });
  expect(f.recorder.getDiagnostics().error).toContain('restart limit');
  expect(f.onChunk).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('60 second recovery ceiling also bounds slow preparation failures', async () => {
  const f = fake(); await f.start();
  f.driver.prepare = async () => { await new Promise(resolve => setTimeout(resolve, 9000)); throw Error('busy'); };
  f.sampleTime(30_000); await jest.advanceTimersByTimeAsync(80_000);
  expect(f.recorder.getState()).toBe('idle');
  expect(f.onWarning).toHaveBeenCalledWith({ kind: 'mic-ended' });
});

test('driver events rotate immediately without interval delivery', async () => {
  const f = fake(); await f.start(); f.sampleTime(30_000);
  f.tick(); await flush(); expect(f.onChunk).toHaveBeenCalledTimes(1);
  await f.recorder.stop();
});

test('more than three hours of fake captures retain a contiguous audio timeline', async () => {
  const f = fake(); f.duration(30_000); f.driver.prepareAhead = f.driver.prepare;
  await f.start();
  for (let i = 0; i < 361; i++) { f.sampleTime(30_000); f.tick(); await flush(); }
  expect(f.onChunk).toHaveBeenCalledTimes(361);
  f.onChunk.mock.calls.forEach(([chunk], seq) => {
    expect(chunk).toMatchObject({ seq, startMs: seq * 30_000, durationMs: 30_000 });
  });
  expect(f.recorder.getDiagnostics()).toMatchObject({ pendingPersists: 0, rotationGapMs: 0, error: null });
  await f.recorder.stop(); expect(jest.getTimerCount()).toBe(0);
});

test('even a synchronously thrown persist error cannot terminate a session', async () => {
  const f = fake(); f.persist.mockImplementationOnce(() => { throw Error('sync persistence failure'); });
  await f.start(); f.sampleTime(30_000); f.tick(); await flush();
  expect(f.recorder.getState()).toBe('recording');
  f.sampleTime(0); await jest.advanceTimersByTimeAsync(1000);
  expect(f.onChunk).toHaveBeenCalledTimes(1); await f.recorder.stop();
});

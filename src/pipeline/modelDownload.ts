import type { PipelineDeps } from './createPipeline';
import type { ModelState } from './types';

export function createModelDownload(deps: PipelineDeps, kick: () => void) {
  // The contract has no idle state; an empty ID denotes no model requested yet.
  let state: ModelState = { kind: 'ready', modelId: '' };
  const listeners = new Set<(state: ModelState) => void>();
  let active: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let forced = false;
  let selected = '';
  const emit = (next: ModelState) => {
    state = next;
    for (const listener of listeners) {
      try { listener(state); } catch { /* Views cannot interrupt downloads. */ }
    }
  };
  const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clearTimer();
    timer = setTimeout(() => { timer = undefined; void ensureModel(); }, delay);
  };
  function ensureModel(force = false): Promise<void> {
    if (force) { forced = true; clearTimer(); }
    if (active) return active;
    active = (async () => {
      let modelId = selected;
      try {
        modelId = await deps.getModelId();
        if (selected !== modelId) { selected = modelId; attempts = 0; clearTimer(); }
        if (await deps.engine.isModelReady(modelId)) {
          clearTimer(); attempts = 0; forced = false;
          emit({ kind: 'ready', modelId });
          return;
        }
        // Foreground/drain requests must not bypass a failed download's backoff.
        if (timer !== undefined && state.kind === 'error' && !force) return;
        const network = deps.platform === 'web' ? 'wifi' : await deps.getNetworkType();
        if (!forced && network !== 'wifi') {
          emit({ kind: 'waiting-wifi', modelId, sizeBytes: deps.engine.listModels().find(m => m.id === modelId)?.sizeBytes ?? 0 });
          schedule(30_000);
          return;
        }
        clearTimer();
        let lastProgressAt = deps.now();
        emit({ kind: 'downloading', modelId, progress: 0 });
        await deps.engine.downloadModel(modelId, progress => {
          if (deps.now() - lastProgressAt < 500) return;
          lastProgressAt = deps.now();
          emit({ kind: 'downloading', modelId, progress: progress.totalBytes > 0 ? Math.min(1, Math.max(0, progress.receivedBytes / progress.totalBytes)) : 0 });
        });
        if (!await deps.engine.isModelReady(modelId)) throw new Error('전사 모델을 준비하지 못했어요. 다시 시도해 주세요.');
        attempts = 0; forced = false;
        emit({ kind: 'ready', modelId });
        kick();
      } catch (error) {
        emit({ kind: 'error', modelId, message: error instanceof Error ? error.message : String(error) });
        schedule([30_000, 120_000, 600_000][Math.min(attempts++, 2)]);
      }
    })().finally(() => { active = undefined; });
    return active;
  }
  return {
    ensureModel,
    subscribe(listener: (state: ModelState) => void) {
      listeners.add(listener); listener(state);
      return () => { listeners.delete(listener); };
    },
  };
}

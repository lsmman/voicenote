import React, { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AudioStatus } from 'expo-audio';
import type { AudioChunk } from '../../core/types';

const mockListeners = new Set<(status: Partial<AudioStatus>) => void>();
const mockPlayer = {
  pause: jest.fn(), play: jest.fn(), seekTo: jest.fn(async () => {}), setPlaybackRate: jest.fn(),
  replace: jest.fn(() => { for (const listener of [...mockListeners]) listener({ isLoaded: true, error: null }); }),
  addListener: jest.fn((_name: string, listener: (status: Partial<AudioStatus>) => void) => {
    mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
  }),
};
jest.mock('expo-audio', () => ({ useAudioPlayer: () => mockPlayer }));
jest.mock('../../services', () => ({ store: { getAudioBlob: jest.fn() }, sync: { chunkUrl: jest.fn(async (path: string) => `https://audio/${path}`) } }));
jest.mock('../../components/Timeline', () => ({ Timeline: () => null }));
import { ChunkPlayer, type ChunkPlayerHandle } from '../../components/ChunkPlayer';
const chunks: AudioChunk[] = [0, 1].map(seq => ({ noteId: 'n', seq, startMs: seq * 30000, durationMs: 30000, localPath: `file:///chunk-${seq}.m4a`, remotePath: null, mimeType: 'audio/mp4', uploadedAt: null, transcribedAt: null }));
let tree: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockListeners.clear(); });
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); }); });
test('global seek loads the matching chunk and seeks in seconds before playback', async () => {
  const ref = createRef<ChunkPlayerHandle>(); const onPosition = jest.fn();
  await act(async () => { tree = create(<ChunkPlayer ref={ref} chunks={chunks} memos={[]} onPosition={onPosition} />); });
  await act(async () => { ref.current?.seek(35000, true); });
  expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: 'file:///chunk-1.m4a' });
  expect(mockPlayer.seekTo).toHaveBeenCalledWith(5);
  expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  expect(onPosition).toHaveBeenCalledWith(35000);
});
test('finishing a chunk advances once, and finishing the final chunk stops the timeline', async () => {
  const ref = createRef<ChunkPlayerHandle>(); const onPosition = jest.fn();
  await act(async () => { tree = create(<ChunkPlayer ref={ref} chunks={chunks} memos={[]} onPosition={onPosition} />); });
  await act(async () => { ref.current?.seek(0, true); });
  await act(async () => { for (const listener of [...mockListeners]) listener({ isLoaded: true, currentTime: 30, playing: false, didJustFinish: true }); });
  expect(mockPlayer.replace).toHaveBeenLastCalledWith({ uri: 'file:///chunk-1.m4a' });
  expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  await act(async () => { for (const listener of [...mockListeners]) listener({ isLoaded: true, currentTime: 30, playing: false, didJustFinish: true }); });
  expect(onPosition).toHaveBeenLastCalledWith(60000);
  expect(mockPlayer.replace).toHaveBeenCalledTimes(2);
});
test('seeking while paused does not start playback and subscriptions are released', async () => {
  const ref = createRef<ChunkPlayerHandle>();
  await act(async () => { tree = create(<ChunkPlayer ref={ref} chunks={chunks} memos={[]} onPosition={() => {}} />); });
  await act(async () => { ref.current?.seek(10000, false); });
  expect(mockPlayer.play).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
  expect(mockListeners.size).toBe(0);
});

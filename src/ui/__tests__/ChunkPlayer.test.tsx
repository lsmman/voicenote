import React, { createRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { AudioStatus } from 'expo-audio';
import type { AudioChunk } from '../../core/types';

type MockPlayer = {
  id: string; listeners: Set<(status: AudioStatus) => void>; emit: (status: Partial<AudioStatus>) => void;
  currentStatus: Partial<AudioStatus>; pause: jest.Mock; play: jest.Mock; seekTo: jest.Mock;
  setPlaybackRate: jest.Mock; remove: jest.Mock; replace: jest.Mock; addListener: jest.Mock;
};
function mockMakePlayer(): MockPlayer {
  const listeners = new Set<(status: AudioStatus) => void>();
  const id: string = String(mockPlayers.length);
  const emit = (status: Partial<AudioStatus>) => { for (const listener of [...listeners]) listener({ id, duration: 30, isLoaded: true, currentTime: 0, playing: false, ...status } as AudioStatus); };
  const player = {
    id, listeners, emit, currentStatus: { id, isLoaded: false, duration: 0 },
    pause: jest.fn(), play: jest.fn(), seekTo: jest.fn(async () => {}), setPlaybackRate: jest.fn(), remove: jest.fn(),
    replace: jest.fn(() => { if (mockAutoLoad) emit({}); }),
    addListener: jest.fn((_name: string, listener: (status: AudioStatus) => void) => {
      listeners.add(listener); return { remove: () => listeners.delete(listener) };
    }),
  };
  mockPlayers.push(player); return player;
}
const mockPlayers: MockPlayer[] = [];
let mockAutoLoad = true;
jest.mock('expo-audio', () => ({ createAudioPlayer: () => mockMakePlayer() }));
jest.mock('../../services', () => ({ store: { getAudioBlob: jest.fn() }, sync: { chunkUrl: jest.fn(async (path: string) => `https://audio/${path}`) } }));
import { ChunkPlayer, type ChunkPlayerHandle } from '../../components/ChunkPlayer';
import { Timeline } from '../../components/Timeline';
const chunks: AudioChunk[] = [0, 1].map(seq => ({ noteId: 'n', seq, startMs: seq * 30000, durationMs: 30000, localPath: `file:///chunk-${seq}.m4a`, remotePath: null, mimeType: 'audio/mp4', uploadedAt: null, transcribedAt: null }));
let tree: ReactTestRenderer;
beforeEach(() => { mockPlayers.length = 0; mockAutoLoad = true; });
afterEach(async () => { if (tree) await act(async () => { tree.unmount(); }); });
async function mount(input = chunks) {
  const ref = createRef<ChunkPlayerHandle>(); const onPosition = jest.fn();
  await act(async () => { tree = create(<ChunkPlayer ref={ref} chunks={input} memos={[]} onPosition={onPosition} />); });
  return { ref, onPosition };
}
test('global seek loads the matching source and seeks in seconds before playback', async () => {
  const { ref, onPosition } = await mount();
  await act(async () => { ref.current?.seek(35000, true); });
  expect(mockPlayers[0].replace).toHaveBeenCalledWith({ uri: 'file:///chunk-1.m4a' });
  expect(mockPlayers[0].seekTo).toHaveBeenCalledWith(5);
  expect(mockPlayers[0].play).toHaveBeenCalledTimes(1); expect(onPosition).toHaveBeenCalledWith(35000);
});
test('overlapping and equal starts advance by index at offset zero, then stop at the end', async () => {
  const input = [chunks[0], { ...chunks[1], startMs: 29000 }, { ...chunks[1], seq: 2, startMs: 29000, localPath: 'file:///chunk-2.m4a' }];
  const { ref, onPosition } = await mount(input);
  await act(async () => { ref.current?.seek(0, true); });
  for (let index = 0; index < 2; index++) {
    await act(async () => { mockPlayers[index].emit({ currentTime: 30, didJustFinish: true }); });
    expect(mockPlayers[index + 1].replace).toHaveBeenCalledWith({ uri: `file:///chunk-${index + 1}.m4a` });
    expect(mockPlayers[index + 1].seekTo).toHaveBeenCalledWith(0);
    expect(mockPlayers[index].remove).toHaveBeenCalledTimes(1);
  }
  await act(async () => { mockPlayers[2].emit({ currentTime: 30, didJustFinish: true }); });
  expect(onPosition).toHaveBeenLastCalledWith(59000); expect(mockPlayers).toHaveLength(3);
});
test('zero duration and stale-source status cannot resolve a new load', async () => {
  mockAutoLoad = false;
  const { ref } = await mount();
  await act(async () => { ref.current?.seek(0, true); });
  const oldCallback = [...mockPlayers[0].listeners][0];
  await act(async () => { ref.current?.seek(35000, true); });
  await act(async () => {
    oldCallback({ id: '0', isLoaded: true, duration: 30 } as AudioStatus);
    mockPlayers[1].emit({ id: '0' }); mockPlayers[1].emit({ duration: 0 });
  });
  expect(mockPlayers[1].seekTo).not.toHaveBeenCalled(); expect(mockPlayers[1].play).not.toHaveBeenCalled();
  await act(async () => { mockPlayers[1].emit({}); });
  expect(mockPlayers[1].seekTo).toHaveBeenCalledWith(5); expect(mockPlayers[1].play).toHaveBeenCalledTimes(1);
});
test('reported duration drives unknown-duration timeline, progress and final position', async () => {
  const { ref, onPosition } = await mount([{ ...chunks[0], durationMs: 0 }]);
  await act(async () => { ref.current?.seek(5000, true); });
  expect(mockPlayers[0].seekTo).toHaveBeenCalledWith(5);
  expect(tree.root.findByType(Timeline).props.durationMs).toBe(30000);
  await act(async () => { mockPlayers[0].emit({ currentTime: 12 }); });
  expect(onPosition).toHaveBeenLastCalledWith(12000);
  await act(async () => { mockPlayers[0].emit({ currentTime: 30, didJustFinish: true }); });
  expect(onPosition).toHaveBeenLastCalledWith(30000);
});
test('paused seeks stay paused and cleanup releases player and listeners', async () => {
  const { ref } = await mount();
  await act(async () => { ref.current?.seek(10000, false); });
  expect(mockPlayers[0].play).not.toHaveBeenCalled();
  await act(async () => { tree.unmount(); });
  expect(mockPlayers[0].listeners.size).toBe(0); expect(mockPlayers[0].remove).toHaveBeenCalledTimes(1);
});

import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ModelState } from '../../pipeline/types';
const mockDownload = jest.fn(async () => {});
let mockListener: (state: ModelState) => void;
const mockUnsubscribe = jest.fn();
jest.mock('../../services', () => ({ pipeline: {
  onModelState: (listener: (state: ModelState) => void) => { mockListener = listener; listener({ kind: 'ready', modelId: 'test' }); return mockUnsubscribe; },
  downloadModelNow: () => mockDownload(),
} }));
import { ModelBanner } from '../ModelBanner';
import { Button } from '../primitives';
let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); jest.clearAllMocks(); });
test('shared model subscription renders progress, wifi consent, error retry, and hides ready', async () => {
  await act(async () => { tree = create(<ModelBanner />); });
  expect(tree.toJSON()).toBeNull();
  await act(async () => mockListener({ kind: 'downloading', modelId: 'test', progress: 0.42 }));
  expect(JSON.stringify(tree.toJSON())).toContain('전사 모델 받는 중 42%');
  expect(tree.root.findAll(node => node.props.accessibilityRole === 'progressbar')[0].props.accessibilityValue.now).toBe(42);
  await act(async () => mockListener({ kind: 'waiting-wifi', modelId: 'test', sizeBytes: 104857600 }));
  expect(JSON.stringify(tree.toJSON())).toContain('Wi-Fi에 연결되면 전사 모델(100 MB)을 받아요');
  expect(tree.root.findByType(Button).props.title).toBe('지금 받기');
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(mockDownload).toHaveBeenCalledTimes(1);
  await act(async () => mockListener({ kind: 'error', modelId: 'test', message: 'Download failed' }));
  expect(JSON.stringify(tree.toJSON())).toContain('전사 모델을 받지 못했어요');
  expect(tree.root.findByType(Button).props.title).toBe('다시 시도');
  await act(async () => tree.root.findByType(Button).props.onPress());
  expect(mockDownload).toHaveBeenCalledTimes(2);
  await act(async () => mockListener({ kind: 'ready', modelId: 'test' }));
  expect(tree.toJSON()).toBeNull();
  await act(async () => tree.unmount()); expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
});

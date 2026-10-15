import { setLanguage } from '../../../i18n/language';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SummaryInfographic } from '../SummaryInfographic';
import { SpeechFlow } from '../SpeechFlow';
import type { Summary } from '../../../core/types';
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await setLanguage('ko'); });

let tree: ReactTestRenderer;
afterEach(async () => { await act(async () => tree?.unmount()); });
const summary: Summary = { noteId: 'n', summary: [{ text: '시간 없는 포인트', atMs: null }, { text: '핵심 내용', atMs: 30000 }], todos: [{ text: '후속 작업', atMs: 30000 }], keywords: ['회의'], createdAt: '' };
test('markers, columns and timestamp chips seek; hover/long press and table expose bucket data', async () => {
  const onSeek = jest.fn();
  await act(async () => { tree = create(<SummaryInfographic summary={summary} durationMs={2400000} segments={[{ id: 's', noteId: 'n', text: '회의회의', startMs: 0, endMs: 120000, edited: false, speakerLabel: null }]} memos={[{ id: 'm', noteId: 'n', kind: 'bookmark', text: '', atMs: 30000 }]} onSeek={onSeek} />); });
  const button = (label: string) => tree.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button').find(node => node.props.accessibilityLabel === label)!;
  const marker = tree.root.findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button').find(node => String(node.props.accessibilityLabel).startsWith('핵심 포인트 2 ·'))!;
  await act(async () => marker.props.onPress());
  expect(onSeek).toHaveBeenLastCalledWith(30000);
  await act(async () => marker.props.onLongPress());
  expect(tree.root.findAll(node => typeof node.type === 'string').some(node => node.props.children === '핵심 내용')).toBe(true);
  const column = button('01:00–02:00 · 2자, 이 위치부터 듣기');
  await act(async () => column.props.onPress());
  expect(onSeek).toHaveBeenLastCalledWith(60000);
  await act(async () => column.props.onHoverIn());
  expect(tree.root.findAll(node => typeof node.type === 'string').some(node => node.props.children === '01:00–02:00 · 2자')).toBe(true);
  await act(async () => column.props.onHoverOut());
  expect(tree.root.findAll(node => typeof node.type === 'string').some(node => node.props.children === '01:00–02:00 · 2자')).toBe(false);
  await act(async () => button('00:30부터 듣기').props.onPress());
  expect(onSeek).toHaveBeenLastCalledWith(30000);
  await act(async () => button('표로 보기').props.onPress());
  expect(tree.root.findAll(node => typeof node.type === 'string').some(node => node.props.accessibilityLabel === '시간대별 글자 수 표')).toBe(true);
  await act(async () => button('표 닫기').props.onPress());
  expect(tree.root.findAll(node => typeof node.type === 'string').some(node => node.props.accessibilityLabel === '시간대별 글자 수 표')).toBe(false);
  const markers = tree.root.findByType(SpeechFlow).findAll(node => typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button').filter(node => /^(핵심 포인트|할 일|메모) ·|^핵심 포인트 2/.test(String(node.props.accessibilityLabel)));
  expect(new Set(markers.map(node => StyleSheet.flatten(node.props.style).top)).size).toBe(3);
});

test('mounted summary statistics and bookmark labels follow language changes', async () => {
  await act(async () => { tree = create(<SummaryInfographic summary={summary} durationMs={60000} segments={[]} memos={[{ id: 'b', noteId: 'n', kind: 'bookmark', text: '', atMs: 1000 }]} onSeek={jest.fn()} />); });
  await act(async () => { await setLanguage('en'); });
  expect(JSON.stringify(tree.toJSON())).toContain('Duration');
  expect(tree.root.findByType(SpeechFlow).props.markers.some((marker: { text: string }) => marker.text === 'Bookmark')).toBe(true);
  await act(async () => { await setLanguage('zh'); });
  expect(JSON.stringify(tree.toJSON())).toContain('录音时长');
  expect(tree.root.findByType(SpeechFlow).props.markers.some((marker: { text: string }) => marker.text === '书签')).toBe(true);
});

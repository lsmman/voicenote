import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { t, useT } from '..';
import { setLanguage, type Language } from '../language';
import { ko, messages, type MessageKey } from '../messages';
import { formatDate, formatTime, formatTimestamp, getLocale, statusLabel } from '../../ui/format';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
beforeEach(async () => { await setLanguage('ko'); });
afterEach(async () => { await setLanguage('ko'); });

test('all translations preserve the Korean keys and interpolation parameters', () => {
  const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const language of ['en', 'zh'] as const) {
    expect(Object.keys(messages[language]).sort()).toEqual(Object.keys(ko).sort());
    for (const key of Object.keys(ko) as MessageKey[]) {
      expect(messages[language][key].trim()).not.toBe('');
      expect(params(messages[language][key])).toEqual(params(ko[key]));
    }
  }
});

test.each<[Language, string, string]>([
  ['ko', 'ko-KR', '전사 중 25%'], ['en', 'en-US', 'Transcribing 25%'], ['zh', 'zh-CN', '转写中 25%'],
])('formats dates and elapsed time in %s', async (language, locale, status) => {
  await setLanguage(language);
  expect(getLocale()).toBe(locale);
  const date = '2026-10-15T12:00:00Z';
  expect(formatDate(date)).toBe(new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(date)));
  expect(formatDate('invalid')).toBe('');
  expect(formatTime(3661000)).toBe('01:01:01');
  expect(formatTimestamp(3661000)).toBe('61:01');
  expect(statusLabel('transcribing', { done: 1, total: 4 })).toBe(status);
});

test('interpolation preserves user text, including replacement characters', async () => {
  await setLanguage('en');
  expect(t('signedInAs', { p0: '$& {name}' })).toBe('Signed in as $& {name}.');
  expect(t('memoAttached', { p0: '01:23', p1: 'Bookmark' })).toBe('Added Bookmark at 01:23.');
});

test('useT updates mounted UI when the language changes', async () => {
  function Label() { const translate = useT(); return <Text>{translate('settings')}</Text>; }
  let tree!: ReactTestRenderer;
  try {
    await act(async () => { tree = create(<Label />); });
    expect(tree.root.findByType(Text).props.children).toBe('설정');
    await act(async () => { await setLanguage('en'); });
    expect(tree.root.findByType(Text).props.children).toBe('Settings');
    await act(async () => { await setLanguage('zh'); });
    expect(tree.root.findByType(Text).props.children).toBe('设置');
  } finally { await act(async () => tree?.unmount()); }
});

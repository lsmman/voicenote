import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { setLanguage } from '../../../i18n/language';
import { LandingPage } from '../LandingPage';
import { hasSeenWelcome, markWelcomeSeen } from '../seen';
import { strings } from '../strings';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-router', () => ({ router: { replace: jest.fn(), push: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

let tree: ReactTestRenderer;
const originalOS = Platform.OS;
beforeEach(async () => { jest.clearAllMocks(); await AsyncStorage.clear(); await setLanguage('en'); });
afterEach(async () => { await act(async () => tree?.unmount()); Platform.OS = originalOS; });
const button = (label: string) => tree.root.findAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

test('renders localized content and plain web docs links; language switch updates content', async () => {
  Platform.OS = 'web';
  await act(async () => { tree = create(<LandingPage />); });
  for (const [language, label, path] of [['ko', '한국어', '/docs/ko'], ['zh', '简体中文', '/docs/zh'], ['en', 'English', '/docs']] as const) {
    await act(async () => button(label).props.onPress());
    expect(tree.root.findByType('a').props.href).toBe(path);
    expect(JSON.stringify(tree.toJSON())).toContain(strings[language].features[0].title);
    expect(button(strings[language].start)).toBeDefined();
  }
});

test('start waits for seen storage before replacing home; sign in opens login', async () => {
  await act(async () => { tree = create(<LandingPage />); });
  await act(async () => button(strings.en.signin).props.onPress());
  expect(router.push).toHaveBeenCalledWith('/login');
  let finish!: () => void;
  jest.mocked(AsyncStorage.setItem).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => button(strings.en.start).props.onPress());
  expect(router.replace).not.toHaveBeenCalled();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('voicenote.welcomeSeen', 'true');
  await act(async () => finish());
  expect(router.replace).toHaveBeenCalledWith('/');
});

test('seen flag round-trips and storage failures are nonfatal', async () => {
  expect(await hasSeenWelcome()).toBe(false);
  await markWelcomeSeen();
  expect(await hasSeenWelcome()).toBe(true);
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('unavailable'));
  expect(await hasSeenWelcome()).toBe(false);
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('full'));
  await expect(markWelcomeSeen()).resolves.toBeUndefined();
});

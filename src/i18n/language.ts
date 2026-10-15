import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type Language = 'ko' | 'en' | 'zh';
export const LANGUAGES: Language[] = ['ko', 'en', 'zh'];
const KEY = 'voicenote.language';

/** Maps a BCP 47 tag to a supported language: Korean, Chinese, otherwise English. */
export function languageFromTag(tag: string | null | undefined): Language | null {
  const base = tag?.toLowerCase().split(/[-_]/)[0];
  if (base === 'ko') return 'ko';
  if (base === 'zh') return 'zh';
  if (base === 'en') return 'en';
  return null;
}

function detect(): Language {
  const tags: string[] = [];
  if (typeof navigator !== 'undefined') tags.push(...(navigator.languages ?? []), navigator.language);
  try { tags.push(Intl.DateTimeFormat().resolvedOptions().locale); } catch { /* no Intl locale */ }
  for (const tag of tags) {
    const language = languageFromTag(tag);
    if (language) return language;
  }
  return 'en';
}

let current: Language = detect();
const listeners = new Set<() => void>();

export function getLanguage(): Language { return current; }

/** Applies the language saved by the user, if any; call once at startup. */
export async function loadLanguage(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem(KEY);
    if (saved === 'ko' || saved === 'en' || saved === 'zh') apply(saved);
  } catch { /* keep the detected language */ }
  return current;
}

export async function setLanguage(language: Language): Promise<void> {
  apply(language);
  try { await AsyncStorage.setItem(KEY, language); } catch { /* still applied for this session */ }
}

function apply(language: Language) {
  if (language === current) return;
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
  for (const listener of listeners) listener();
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

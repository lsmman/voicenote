import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'voicenote.welcomeSeen';

export async function hasSeenWelcome(): Promise<boolean> {
  try { return await AsyncStorage.getItem(KEY) === 'true'; }
  catch { return false; }
}

export async function markWelcomeSeen(): Promise<void> {
  try { await AsyncStorage.setItem(KEY, 'true'); }
  catch { /* Storage failure must not prevent entering the app. */ }
}

import { Platform } from 'react-native';
import { NetworkStateType, getNetworkStateAsync } from 'expo-network';
import { getModelId } from '../core/settings';
import { store } from '../store';
import { recorder } from '../recorder';
import { engine } from '../transcriber';
import { sync, supabase } from '../sync';
import { createPipeline } from './createPipeline';
import { createCleanupLocal } from './uploadQueue';
import { deleteLocalFile } from './localFile';

export const pipeline = createPipeline({
  store, recorder, engine, sync, getModelId, now: Date.now,
  platform: Platform.OS === 'web' ? 'web' : 'native',
  async getNetworkType() {
    if (Platform.OS === 'web') return 'wifi';
    const state = await getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) return 'none';
    if (state.type === NetworkStateType.WIFI || state.type === NetworkStateType.ETHERNET) return 'wifi';
    if (state.type === NetworkStateType.CELLULAR) return 'cellular';
    return state.type === NetworkStateType.NONE ? 'none' : 'unknown';
  },
  async isSignedIn() {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session !== null;
  },
  async userId() {
    const { data } = await supabase.auth.getSession();
    return data.session?.user.id ?? null;
  },
  async isOnline() {
    const state = await getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
});

export const cleanupLocal = createCleanupLocal(store, deleteLocalFile);
export { createPipeline } from './createPipeline';

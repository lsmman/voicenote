import { getNetworkStateAsync } from 'expo-network';
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
  async isSignedIn() {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session !== null;
  },
  async isOnline() {
    const state = await getNetworkStateAsync();
    return state.isConnected === true && state.isInternetReachable !== false;
  },
});

export const cleanupLocal = createCleanupLocal(store, deleteLocalFile);
export { createPipeline } from './createPipeline';

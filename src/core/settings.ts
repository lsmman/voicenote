import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const MODEL_KEY = 'voicenote.modelId';
// Web runs Whisper on WASM/WebGPU in the browser; large-v3-turbo (~1.3GB) is
// slower than real time there, so web defaults to small. Native whisper.cpp
// keeps up with large-v3-turbo.
export const DEFAULT_MODEL_ID = Platform.OS === 'web' ? 'small-q5_1' : 'large-v3-turbo-q5_0';

export async function getModelId(): Promise<string> {
  return (await AsyncStorage.getItem(MODEL_KEY)) ?? DEFAULT_MODEL_ID;
}

export async function setModelId(id: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, id);
}

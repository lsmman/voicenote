import AsyncStorage from '@react-native-async-storage/async-storage';

const MODEL_KEY = 'voicenote.modelId';
export const DEFAULT_MODEL_ID = 'large-v3-turbo-q5_0';

export async function getModelId(): Promise<string> {
  return (await AsyncStorage.getItem(MODEL_KEY)) ?? DEFAULT_MODEL_ID;
}

export async function setModelId(id: string): Promise<void> {
  await AsyncStorage.setItem(MODEL_KEY, id);
}

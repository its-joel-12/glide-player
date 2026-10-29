import AsyncStorage from '@react-native-async-storage/async-storage';

export const StorageKeys = {
  preferences: 'glide.preferences.v1',
  resume: 'glide.resume.v1',
  thumbnails: 'glide.thumbnails.v1',
} as const;

export async function loadJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export async function saveJSON(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: settings just won't be remembered.
  }
}

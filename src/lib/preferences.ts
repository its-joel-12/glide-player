/**
 * Settings kept on this phone. A tiny store so any component can read them with usePreferences().
 */
import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';

import { DefaultPreferences, normalizePreferences, type Preferences } from './settings-schema';
import { loadJSON, saveJSON, StorageKeys } from './storage';

export type { Preferences } from './settings-schema';

type State = Preferences & { loaded: boolean };

let prefs: State = { ...DefaultPreferences, loaded: false };
const listeners = new Set<() => void>();

function emit(next: State) {
  prefs = next;
  // Also switch system-drawn UI (dialogs, pickers).
  const setScheme = (Appearance as { setColorScheme?: (s: 'light' | 'dark' | 'unspecified') => void }).setColorScheme;
  try {
    setScheme?.(next.theme === 'system' ? 'unspecified' : next.theme);
  } catch {
    // not available on every platform
  }
  listeners.forEach((l) => l());
}

let loading: Promise<void> | null = null;
export function loadPreferences(): Promise<void> {
  loading ??= loadJSON<unknown>(StorageKeys.preferences, {}).then((saved) => {
    emit({ ...normalizePreferences(saved), loaded: true });
  });
  return loading;
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  emit({ ...prefs, [key]: value });
  const { loaded: _loaded, ...toSave } = prefs;
  void saveJSON(StorageKeys.preferences, toSave);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => prefs;

export function usePreferences(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getPreferences(): State {
  return prefs;
}

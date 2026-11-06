/** Which videos were watched to the end (shown as a tick on the thumbnail). */
import { useSyncExternalStore } from 'react';

import { mediaKey } from './media-key';
import { loadJSON, saveJSON, StorageKeys } from './storage';

/** media key → when it was finished (ms since 1970). */
let watched: Record<string, number> = {};
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function emit(next: Record<string, number>) {
  watched = next;
  listeners.forEach((l) => l());
  void saveJSON(StorageKeys.watched, watched);
}

export function loadWatched(): Promise<void> {
  loading ??= loadJSON<Record<string, number>>(StorageKeys.watched, {}).then((saved) => {
    watched = { ...(saved && typeof saved === 'object' ? saved : {}), ...watched };
    listeners.forEach((l) => l());
  });
  return loading;
}

export function isWatched(id: string): boolean {
  return mediaKey(id) in watched;
}

export function setWatched(id: string, value: boolean) {
  const key = mediaKey(id);
  if (value === key in watched) return;
  if (value) emit({ ...watched, [key]: Date.now() });
  else {
    const { [key]: _removed, ...rest } = watched;
    emit(rest);
  }
}

/** Same as setWatched for many videos, saved once. */
export function setWatchedMany(ids: string[], value: boolean) {
  const next = { ...watched };
  const now = Date.now();
  let changed = false;
  for (const id of ids) {
    const key = mediaKey(id);
    if (value === key in next) continue;
    changed = true;
    if (value) next[key] = now;
    else delete next[key];
  }
  if (changed) emit(next);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The watched map; re-renders when it changes. */
export function useWatched(): Record<string, number> {
  return useSyncExternalStore(subscribe, () => watched, () => watched);
}

export function watchedIn(map: Record<string, number>, id: string): boolean {
  return mediaKey(id) in map;
}

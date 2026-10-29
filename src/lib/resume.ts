/** Remembers where each video was left, so it can continue from there. */
import { useSyncExternalStore } from 'react';

import { pruneEntries, type ResumeEntry } from './resume-rules';
import { loadJSON, saveJSON, StorageKeys } from './storage';

export type { ResumeEntry } from './resume-rules';
export { continueWatching, progressFraction, startPosition } from './resume-rules';

let entries: Record<string, ResumeEntry> = {};
let loaded = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function emit(next: Record<string, ResumeEntry>) {
  entries = next;
  listeners.forEach((l) => l());
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveJSON(StorageKeys.resume, pruneEntries(entries)), 800);
}

let loading: Promise<void> | null = null;
export function loadResume(): Promise<void> {
  loading ??= loadJSON<Record<string, ResumeEntry>>(StorageKeys.resume, {}).then((saved) => {
    entries = saved && typeof saved === 'object' ? saved : {};
    loaded = true;
    listeners.forEach((l) => l());
  });
  return loading;
}

export function getResume(id: string): ResumeEntry | undefined {
  return entries[id];
}

export function saveResume(id: string, entry: Omit<ResumeEntry, 'updatedAt'>) {
  if (!loaded || !(entry.durationMs > 0)) return;
  emit({ ...entries, [id]: { ...entry, updatedAt: Date.now() } });
}

export function clearResume(id: string) {
  if (!entries[id]) return;
  const { [id]: _removed, ...rest } = entries;
  emit(rest);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => entries;

export function useResumeEntries(): Record<string, ResumeEntry> {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

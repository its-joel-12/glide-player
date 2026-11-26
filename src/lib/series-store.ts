/** The user's series fixes (names, merges, ungrouped) kept on this phone, with a hook for screens. */
import { useSyncExternalStore } from 'react';

import { mergeSeries, normalizeOverrides, NO_OVERRIDES, renameSeries, setUngrouped, unmergeSeries, type SeriesOverrides } from './series';
import { loadJSON, saveJSON, StorageKeys } from './storage';

let overrides: SeriesOverrides = NO_OVERRIDES;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function emit(next: SeriesOverrides) {
  if (next === overrides) return;
  overrides = next;
  listeners.forEach((l) => l());
  void saveJSON(StorageKeys.series, overrides);
}

export function loadSeriesOverrides(): Promise<void> {
  loading ??= loadJSON<unknown>(StorageKeys.series, null).then((saved) => {
    const s = normalizeOverrides(saved);
    // Anything changed before loading finished wins.
    overrides = { names: { ...s.names, ...overrides.names }, merged: { ...s.merged, ...overrides.merged }, ungrouped: [...new Set([...s.ungrouped, ...overrides.ungrouped])] };
    listeners.forEach((l) => l());
  });
  return loading;
}

export const renameSeriesTo = (key: string, name: string) => emit(renameSeries(overrides, key, name));
export const mergeSeriesInto = (from: string, into: string) => emit(mergeSeries(overrides, from, into));
export const splitOffSeries = (key: string) => emit(unmergeSeries(overrides, key));
export const ungroupSeries = (key: string, ungrouped = true) => emit(setUngrouped(overrides, key, ungrouped));

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => overrides;

export function useSeriesOverrides(): SeriesOverrides {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

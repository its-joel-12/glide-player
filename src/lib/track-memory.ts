/** Remembers the audio and subtitle track picked for each video, so coming back to it keeps them. */
import { pruneMemory, type TrackMemory, type TrackPick } from './track-memory-rules';
import { loadJSON, saveJSON, StorageKeys } from './storage';

export type { TrackMemory, TrackPick } from './track-memory-rules';
export { pickOf, restoreChoice } from './track-memory-rules';

let entries: Record<string, TrackMemory> = {};
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let loading: Promise<void> | null = null;

export function loadTrackMemory(): Promise<void> {
  loading ??= loadJSON<Record<string, TrackMemory>>(StorageKeys.tracks, {}).then((saved) => {
    // Anything picked before loading finished wins over what was saved.
    entries = saved && typeof saved === 'object' ? { ...saved, ...entries } : entries;
  });
  return loading;
}

export function getTrackMemory(id: string): TrackMemory | undefined {
  return entries[id];
}

/** Saves the audio pick (undefined = let the player choose) or the subtitle pick ('off' = none). */
export function rememberTrack(id: string, kind: 'audio', pick: TrackPick | undefined): void;
export function rememberTrack(id: string, kind: 'text', pick: TrackPick | 'off' | undefined): void;
export function rememberTrack(id: string, kind: 'audio' | 'text', pick: TrackPick | 'off' | undefined) {
  const next: TrackMemory = { ...entries[id], [kind]: pick, updatedAt: Date.now() };
  if (pick === undefined) delete next[kind];
  entries = { ...entries, [id]: next };
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveJSON(StorageKeys.tracks, pruneMemory(entries)), 500);
}

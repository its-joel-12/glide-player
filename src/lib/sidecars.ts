/**
 * Subtitle files that belong to a video, e.g. the text subtitles saved when making a seekable copy
 * (MP4 copies can't hold them). The player loads them with the video.
 */
import type { SubtitleSource } from 'glide-engine';

import { sidecarKey } from './media-key';
import { loadJSON, saveJSON, StorageKeys } from './storage';

let entries: Record<string, SubtitleSource[]> = {};
let loading: Promise<void> | null = null;

export function loadSidecars(): Promise<void> {
  loading ??= loadJSON<Record<string, SubtitleSource[]>>(StorageKeys.sidecars, {}).then((saved) => {
    entries = saved && typeof saved === 'object' ? { ...saved, ...entries } : entries;
  });
  return loading;
}

export function getSidecars(uri: string): SubtitleSource[] {
  return entries[sidecarKey(uri)] ?? [];
}

export function setSidecars(uri: string, subtitles: SubtitleSource[]) {
  if (!subtitles.length) return;
  entries = { ...entries, [sidecarKey(uri)]: subtitles };
  void saveJSON(StorageKeys.sidecars, entries);
}

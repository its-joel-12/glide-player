/** When to offer "continue where you left off" (pure; covered by tests). */

export type ResumeEntry = {
  positionMs: number;
  durationMs: number;
  updatedAt: number;
  title: string;
  uri: string;
  width?: number;
  height?: number;
};

/** Where to start a video: its saved position, unless it was barely started or nearly finished. */
export function startPosition(entry: ResumeEntry | undefined): number {
  if (!entry || !(entry.durationMs > 0)) return 0;
  const { positionMs: p, durationMs: d } = entry;
  if (p < 5_000) return 0;
  if (p > d - Math.max(10_000, d * 0.03)) return 0;
  return Math.max(0, p - 2_000); // a couple of seconds back, to pick up the thread
}

/** True once playback is in the last stretch (credits): the same point where resuming stops. */
export function isFinished(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && positionMs > durationMs - Math.max(10_000, durationMs * 0.03);
}

/** 0..1 bar under a thumbnail, or 0 when there is nothing to resume. */
export function progressFraction(entry: ResumeEntry | undefined): number {
  if (!entry || startPosition(entry) === 0) return 0;
  return Math.min(1, entry.positionMs / entry.durationMs);
}

/** Videos to show under "Continue watching", most recent first. */
export function continueWatching(entries: Record<string, ResumeEntry>, limit = 12): (ResumeEntry & { id: string })[] {
  return Object.entries(entries)
    .filter(([, e]) => startPosition(e) > 0)
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
    .slice(0, limit)
    .map(([id, e]) => ({ ...e, id }));
}

/** Keeps the saved list small: the newest [max] entries. */
export function pruneEntries(entries: Record<string, ResumeEntry>, max = 300): Record<string, ResumeEntry> {
  const list = Object.entries(entries);
  if (list.length <= max) return entries;
  return Object.fromEntries(list.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, max));
}

/** Remembering which audio and subtitle track was picked for a video (pure; covered by tests). */

/** A track as the player lists it (same shape as glide-engine's Track). */
export type ListedTrack = { id: string; label: string; language: string; selected: boolean; unsupported?: string };

/**
 * A picked track, described so it can be found again: track ids ("group:track") can change between
 * loads (e.g. after adding a subtitle file), labels and languages don't.
 */
export type TrackPick = { label: string; language: string; index: number };

export type TrackMemory = {
  /** Unset: the player's own choice. */
  audio?: TrackPick;
  /** 'off': subtitles switched off. Unset: the player's own choice. */
  text?: TrackPick | 'off';
  updatedAt: number;
};

export function pickOf(list: ListedTrack[], id: string): TrackPick | undefined {
  const index = list.findIndex((t) => t.id === id);
  if (index < 0) return undefined;
  return { label: list[index].label, language: list[index].language, index };
}

/** The track that matches a remembered pick: same name, else same language, else same place in the list. */
export function findPick(list: ListedTrack[], pick: TrackPick): ListedTrack | undefined {
  const usable = list.map((t, i) => ({ t, i })).filter(({ t }) => !t.unsupported);
  const closest = (c: { t: ListedTrack; i: number }[]) =>
    c.length ? c.reduce((a, b) => (Math.abs(b.i - pick.index) < Math.abs(a.i - pick.index) ? b : a)).t : undefined;
  return (
    closest(usable.filter(({ t }) => t.label === pick.label && t.language === pick.language)) ??
    closest(usable.filter(({ t }) => t.label === pick.label)) ??
    (pick.language ? closest(usable.filter(({ t }) => t.language === pick.language)) : undefined) ??
    usable.find(({ i }) => i === pick.index)?.t
  );
}

/**
 * What to switch to so a remembered choice comes back: a track id, null for "subtitles off", or
 * undefined when nothing needs doing (no memory, already selected, or no such track any more).
 */
export function restoreChoice(list: ListedTrack[], remembered: TrackPick | 'off' | undefined): string | null | undefined {
  if (remembered === undefined || !list.length) return undefined;
  if (remembered === 'off') return list.some((t) => t.selected) ? null : undefined;
  const match = findPick(list, remembered);
  return match && !match.selected ? match.id : undefined;
}

/** Keeps the saved list small: the newest [max] entries. */
export function pruneMemory(entries: Record<string, TrackMemory>, max = 300): Record<string, TrackMemory> {
  const list = Object.entries(entries);
  if (list.length <= max) return entries;
  return Object.fromEntries(list.sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, max));
}

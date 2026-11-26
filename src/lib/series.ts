/**
 * Grouping videos into series by file name (pure; covered by tests). Two or more videos whose names
 * give the same `seriesFromTitle` (the name the skip buttons use too) make a series:
 * "[SubsPlease] Jujutsu Kaisen - 29 (1080p)" and "Jujutsu.Kaisen.S02E05.1080p" are both "jujutsu kaisen".
 * Episodes are ordered by season and episode number read from the name.
 *
 * The user can fix the guesses (`SeriesOverrides`): give a series another name, merge one series into
 * another (e.g. "shingeki no kyojin" into "attack on titan"), or ungroup one so it isn't a series.
 */
import { normalizeForSearch } from './library-search';
import { seriesFromTitle } from './skip-rules';

export type Episode = { season?: number; episode: number };
export type Series<T> = { key: string; title: string; items: T[]; latest: number };

export type SeriesOverrides = {
  /** series key → name shown instead of the one made from the key */
  names: Record<string, string>;
  /** series key → key of the series it was merged into */
  merged: Record<string, string>;
  /** series keys that are not grouped */
  ungrouped: string[];
};

export const NO_OVERRIDES: SeriesOverrides = { names: {}, merged: {}, ungrouped: [] };

type Item = { id: string; title: string; modifiedAt: number };

const EPISODE_PATTERNS: [RegExp, (m: RegExpMatchArray) => Episode][] = [
  [/\bs(\d{1,2}) ?e(\d{1,4})\b/, (m) => ({ season: +m[1], episode: +m[2] })],
  [/\b(\d{1,2})x(\d{2,4})\b/, (m) => ({ season: +m[1], episode: +m[2] })],
  [/\bseason (\d{1,2})\D*?\b(?:episode|ep|e) ?(\d{1,4})\b/, (m) => ({ season: +m[1], episode: +m[2] })],
  [/\b(?:episode|ep) ?(\d{1,4})\b/, (m) => ({ episode: +m[1] })],
  [/\be(\d{2,4})\b/, (m) => ({ episode: +m[1] })],
];

/** Season and episode from a file name ("S02E05", "2x05", "ep 5", "Frieren - 12"), or null. */
export function episodeFromTitle(title: string): Episode | null {
  const name = normalizeForSearch(title.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, ' '));
  for (const [re, read] of EPISODE_PATTERNS) {
    const m = name.match(re);
    if (m) return read(m);
  }
  // A bare number right after the series name: "jujutsu kaisen 29", "frieren 12 v2".
  const key = seriesFromTitle(title);
  if (key && name.startsWith(key)) {
    const m = name.slice(key.length).match(/^ (\d{1,4})\b/);
    if (m) return { episode: +m[1] };
  }
  return null;
}

/** "S2 E5", "Episode 29" */
export function episodeLabel(e: Episode): string {
  return e.season !== undefined ? `S${e.season} E${e.episode}` : `Episode ${e.episode}`;
}

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'in', 'no', 'of', 'on', 'or', 'the', 'to', 'wa', 'ga']);

/** "attack on titan" → "Attack on Titan" */
export function seriesTitle(key: string): string {
  return key
    .split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const byName = (a: Item, b: Item) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

/** Episodes in watching order: by season, then episode; videos without a number go last, by name. */
export function sortEpisodes<T extends Item>(items: readonly T[]): T[] {
  const eps = new Map(items.map((v) => [v.id, episodeFromTitle(v.title)]));
  return [...items].sort((a, b) => {
    const x = eps.get(a.id);
    const y = eps.get(b.id);
    if (x && y) return (x.season ?? 1) - (y.season ?? 1) || x.episode - y.episode || byName(a, b);
    if (x || y) return x ? -1 : 1;
    return byName(a, b);
  });
}

/** Where a key ends up after merges (follows chains; stops on a loop). */
export function resolveKey(key: string, ov: SeriesOverrides = NO_OVERRIDES): string {
  const seen = new Set<string>();
  let k = key;
  while (ov.merged[k] && !seen.has(k)) {
    seen.add(k);
    k = ov.merged[k];
  }
  return k;
}

/** The series key of a file name after the user's merges; null when that series is ungrouped. */
export function seriesKeyOf(title: string, ov: SeriesOverrides = NO_OVERRIDES): string | null {
  const key = resolveKey(seriesFromTitle(title), ov);
  return ov.ungrouped.includes(key) ? null : key;
}

/** The name shown for a series: the user's, or "Attack on Titan" from the key. */
export function seriesName(key: string, ov: SeriesOverrides = NO_OVERRIDES): string {
  return ov.names[key]?.trim() || seriesTitle(key);
}

/** Gives a series another name; an empty name (or the automatic one) goes back to automatic. */
export function renameSeries(ov: SeriesOverrides, key: string, name: string): SeriesOverrides {
  const { [key]: _old, ...names } = ov.names;
  const n = name.trim().replace(/\s+/g, ' ');
  return { ...ov, names: n && n !== seriesTitle(key) ? { ...names, [key]: n } : names };
}

/** Puts the episodes of `from` into `into`. Ignored if that would make a loop. */
export function mergeSeries(ov: SeriesOverrides, from: string, into: string): SeriesOverrides {
  const target = resolveKey(into, ov);
  if (!from || target === from || resolveKey(from, ov) === target) return ov;
  return { ...ov, merged: { ...ov.merged, [from]: target }, ungrouped: ov.ungrouped.filter((k) => k !== from) };
}

/** Makes a merged series its own series again. */
export function unmergeSeries(ov: SeriesOverrides, key: string): SeriesOverrides {
  const { [key]: _old, ...merged } = ov.merged;
  return { ...ov, merged };
}

/** Series keys merged (directly or through others) into this one. */
export function mergedInto(ov: SeriesOverrides, key: string): string[] {
  return Object.keys(ov.merged)
    .filter((k) => k !== key && resolveKey(k, ov) === key)
    .sort();
}

/** Ungroups a series (its videos are then just videos), or groups it again. */
export function setUngrouped(ov: SeriesOverrides, key: string, ungrouped: boolean): SeriesOverrides {
  const rest = ov.ungrouped.filter((k) => k !== key);
  return { ...ov, ungrouped: ungrouped ? [...rest, key] : rest };
}

/** Saved data → valid overrides (drops anything broken). */
export function normalizeOverrides(saved: unknown): SeriesOverrides {
  const o = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<keyof SeriesOverrides, unknown>>;
  const strings = (x: unknown) =>
    Object.fromEntries(Object.entries(x && typeof x === 'object' && !Array.isArray(x) ? x : {}).filter(([k, v]) => k && typeof v === 'string' && v)) as Record<string, string>;
  return {
    names: strings(o.names),
    merged: strings(o.merged),
    ungrouped: Array.isArray(o.ungrouped) ? [...new Set(o.ungrouped.filter((k): k is string => typeof k === 'string' && !!k))] : [],
  };
}

/** Videos of one series (by key, merges included), in watching order. */
export function videosOfSeries<T extends Item>(items: readonly T[], key: string, ov: SeriesOverrides = NO_OVERRIDES): T[] {
  return sortEpisodes(items.filter((v) => seriesKeyOf(v.title, ov) === key));
}

/**
 * Continue watching with one card per series: only the most recent episode of each (the list comes
 * newest first). Videos that aren't in a series, or whose series is ungrouped, are all kept.
 */
export function oneCardPerSeries<T extends { title: string }>(list: readonly T[], ov: SeriesOverrides = NO_OVERRIDES): T[] {
  const seen = new Set<string>();
  return list.filter((v) => {
    const key = seriesKeyOf(v.title, ov);
    if (key === null) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Series of 2+ videos, the one with the newest video first. Single videos (most films) are left out. */
export function groupSeries<T extends Item>(items: readonly T[], ov: SeriesOverrides = NO_OVERRIDES): Series<T>[] {
  const groups = new Map<string, T[]>();
  for (const v of items) {
    const key = seriesKeyOf(v.title, ov);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(v);
    else groups.set(key, [v]);
  }
  const series: Series<T>[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    series.push({ key, title: seriesName(key, ov), items: sortEpisodes(list), latest: Math.max(...list.map((v) => v.modifiedAt)) });
  }
  return series.sort((a, b) => b.latest - a.latest || a.title.localeCompare(b.title));
}

/** The first episode not watched yet, in order; null when all are watched. */
export function nextEpisode<T>(ordered: readonly T[], isWatched: (v: T) => boolean): T | null {
  return ordered.find((v) => !isWatched(v)) ?? null;
}

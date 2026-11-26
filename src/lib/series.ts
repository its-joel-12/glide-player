/**
 * Grouping videos into series by file name (pure; covered by tests). Two or more videos whose names
 * give the same `seriesFromTitle` (the name the skip buttons use too) make a series:
 * "[SubsPlease] Jujutsu Kaisen - 29 (1080p)" and "Jujutsu.Kaisen.S02E05.1080p" are both "jujutsu kaisen".
 * Episodes are ordered by season and episode number read from the name.
 */
import { normalizeForSearch } from './library-search';
import { seriesFromTitle } from './skip-rules';

export type Episode = { season?: number; episode: number };
export type Series<T> = { key: string; title: string; items: T[]; latest: number };

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

/** Videos of one series (by key), in watching order. */
export function videosOfSeries<T extends Item>(items: readonly T[], key: string): T[] {
  return sortEpisodes(items.filter((v) => seriesFromTitle(v.title) === key));
}

/** Series of 2+ videos, the one with the newest video first. Single videos (most films) are left out. */
export function groupSeries<T extends Item>(items: readonly T[]): Series<T>[] {
  const groups = new Map<string, T[]>();
  for (const v of items) {
    const key = seriesFromTitle(v.title);
    const list = groups.get(key);
    if (list) list.push(v);
    else groups.set(key, [v]);
  }
  const series: Series<T>[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    series.push({ key, title: seriesTitle(key), items: sortEpisodes(list), latest: Math.max(...list.map((v) => v.modifiedAt)) });
  }
  return series.sort((a, b) => b.latest - a.latest || a.title.localeCompare(b.title));
}

/** The first episode not watched yet, in order; null when all are watched. */
export function nextEpisode<T>(ordered: readonly T[], isWatched: (v: T) => boolean): T | null {
  return ordered.find((v) => !isWatched(v)) ?? null;
}

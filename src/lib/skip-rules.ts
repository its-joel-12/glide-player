/**
 * Skip buttons per series (pure; covered by tests). A rule matches videos by file name, the way
 * library search does: every word of `match`, in any order, case, accents and separators ignored.
 * Each of its buttons jumps forward a fixed number of seconds (e.g. "Skip OP" +90 s).
 */
import { matchesWords, normalizeForSearch, queryWords } from './library-search';

export type SkipButton = { id: string; label: string; seconds: number };
export type SkipRule = { id: string; match: string; buttons: SkipButton[]; updatedAt: number };

export const SKIP_SECONDS = { min: 1, max: 600, default: 90 } as const;
export const DEFAULT_SKIP_LABEL = 'Skip intro';

export const clampSkipSeconds = (s: number) => Math.min(SKIP_SECONDS.max, Math.max(SKIP_SECONDS.min, Math.round(Number(s) || SKIP_SECONDS.default)));

/** The rule for this video name: of those whose words all appear in it, the longest (most specific) one. */
export function findRule(title: string, rules: readonly SkipRule[]): SkipRule | undefined {
  const name = normalizeForSearch(title);
  let best: SkipRule | undefined;
  let bestLen = 0;
  for (const r of rules) {
    const words = queryWords(r.match);
    if (!words.length || !r.buttons.length || !matchesWords(name, words)) continue;
    const len = words.join(' ').length;
    if (len > bestLen) {
      best = r;
      bestLen = len;
    }
  }
  return best;
}

// Tags and quality words that come after (or around) the series name in release file names.
const NOISE = /\b(2160p|1080p|720p|576p|480p|360p|4k|uhd|hdr10?|dv|x26[45]|h ?26[45]|hevc|avc|aac|ac3|eac3|dts|flac|opus|web ?dl|web ?rip|webrip|bluray|blu ray|bdrip|brrip|hdtv|dual audio|multi ?subs?|10 ?bit|8 ?bit)\b.*$/;

/**
 * A good starting `match` for the series of this file: "[SubsPlease] Jujutsu Kaisen - 29 (1080p) [ABCD]"
 * and "Jujutsu.Kaisen.S02E05.1080p.WEB" both give "jujutsu kaisen".
 */
export function seriesFromTitle(title: string): string {
  const s = normalizeForSearch(title.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' '))
    // S02E05, s2 e5, 2x05, "season 2", "episode 5", "ep 5", "e05" and anything after them
    .replace(/\b(s\d{1,2} ?e\d{1,4}|\d{1,2}x\d{2,4}|season \d+|episode \d+|ep ?\d+|e\d{2,4})\b.*$/, '')
    .replace(NOISE, '')
    // a bare episode number at the end ("jujutsu kaisen 29"), but not a year-like or single word title
    .replace(/ \d{1,4}( v\d)?$/, '')
    .trim();
  return s || normalizeForSearch(title);
}

/** Saved data → valid rules (drops anything broken). */
export function normalizeRules(saved: unknown): SkipRule[] {
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((r): SkipRule[] => {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.match !== 'string' || !Array.isArray(r.buttons)) return [];
    const buttons = (r.buttons as unknown[]).flatMap((b): SkipButton[] =>
      b && typeof b === 'object' && typeof (b as SkipButton).id === 'string'
        ? [{ id: (b as SkipButton).id, label: String((b as SkipButton).label ?? '') || DEFAULT_SKIP_LABEL, seconds: clampSkipSeconds((b as SkipButton).seconds) }]
        : [],
    );
    return [{ id: r.id, match: r.match, buttons, updatedAt: Number(r.updatedAt) || 0 }];
  });
}

/** "Skip intro +90s" */
export function skipButtonText(b: SkipButton): string {
  return `${b.label.trim() || DEFAULT_SKIP_LABEL} +${b.seconds}s`;
}

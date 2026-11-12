/** Searching the video list by file name (pure; covered by tests). */

/**
 * Lower case, accents removed, and dots, underscores, dashes and brackets turned into spaces, so
 * "The.Matrix_(1999)" reads as "the matrix 1999".
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._\-()[\]{}+,;:!?'"’`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words of a query; empty when there's nothing to search for. */
export function queryWords(query: string): string[] {
  const q = normalizeForSearch(query);
  return q ? q.split(' ') : [];
}

/** Every word must appear somewhere in the name, in any order ("matrix 1080" finds "The.Matrix.1999.1080p"). */
export function matchesWords(normalizedTitle: string, words: readonly string[]): boolean {
  return words.every((w) => normalizedTitle.includes(w));
}

/** The videos whose name matches, in the order given; all of them for an empty query. */
export function searchVideos<T extends { title: string }>(items: readonly T[], query: string): T[] {
  const words = queryWords(query);
  if (!words.length) return [...items];
  return items.filter((v) => matchesWords(normalizeForSearch(v.title), words));
}

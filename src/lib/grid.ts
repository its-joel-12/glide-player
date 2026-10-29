/** Helpers for the video grid (pure; covered by tests). */

/** Appends [page] to [prev], skipping ids already present (pages can overlap when the library changes). */
export function mergeUnique<T extends { id: string }>(prev: T[], page: T[]): T[] {
  const seen = new Set(prev.map((v) => v.id));
  const out = prev.slice();
  for (const v of page) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  return out;
}

/** Splits items into rows of [columns] (the last row may be shorter). */
export function toRows<T>(items: T[], columns: number): T[][] {
  const n = Math.max(1, Math.floor(columns));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

/** How many columns fit: cards at least [minCard] wide with [gap] between them, never fewer than 2. */
export function columnsFor(width: number, minCard = 170, gap = 16): number {
  return Math.max(2, Math.floor((width + gap) / (minCard + gap)));
}

/** Sorting the video list (pure; covered by tests). */

export type LibrarySort = 'newest' | 'oldest' | 'name' | 'nameDesc' | 'longest' | 'shortest';
export type LibraryView = 'grid' | 'list';

export const LIBRARY_SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'nameDesc', label: 'Name (Z–A)' },
  { value: 'longest', label: 'Longest first' },
  { value: 'shortest', label: 'Shortest first' },
];

type Sortable = { id: string; title: string; durationMs: number; modifiedAt: number };

const byName = (a: Sortable, b: Sortable) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });

/** A sorted copy; ties fall back to name, then id, so the order never jumps around. */
export function sortVideos<T extends Sortable>(items: readonly T[], sort: LibrarySort): T[] {
  const cmp: Record<LibrarySort, (a: T, b: T) => number> = {
    newest: (a, b) => b.modifiedAt - a.modifiedAt,
    oldest: (a, b) => a.modifiedAt - b.modifiedAt,
    name: byName,
    nameDesc: (a, b) => byName(b, a),
    longest: (a, b) => b.durationMs - a.durationMs,
    shortest: (a, b) => a.durationMs - b.durationMs,
  };
  return [...items].sort((a, b) => cmp[sort](a, b) || byName(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

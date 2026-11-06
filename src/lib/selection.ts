/** Picking several videos in the library. null = not selecting. */
export type Selection = ReadonlySet<string> | null;

/** Tap (or long-press) on a video: picks or unpicks it. Unpicking the last one ends selecting. */
export function toggleSelected(sel: Selection, id: string): Selection {
  const next = new Set(sel ?? []);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next.size ? next : null;
}

/** "Select all" picks every video; when all are already picked it unpicks them (still selecting). */
export function selectAllToggle(sel: Selection, ids: string[]): Selection {
  return sel && ids.length > 0 && ids.every((id) => sel.has(id)) ? new Set() : new Set(ids);
}

/** Drops picked videos that are no longer listed (after a refresh). Same object if nothing changed. */
export function pruneSelection(sel: Selection, ids: Iterable<string>): Selection {
  if (!sel) return sel;
  const present = new Set(ids);
  const next = new Set([...sel].filter((id) => present.has(id)));
  return next.size === sel.size ? sel : next;
}

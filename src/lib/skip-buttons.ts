/** The skip-button rules kept on this phone, with a hook for screens. */
import { useSyncExternalStore } from 'react';

import { clampSkipSeconds, DEFAULT_SKIP_LABEL, normalizeRules, SKIP_SECONDS, type SkipButton, type SkipRule } from './skip-rules';
import { loadJSON, saveJSON, StorageKeys } from './storage';

export type { SkipButton, SkipRule } from './skip-rules';

let rules: SkipRule[] = [];
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function emit(next: SkipRule[]) {
  rules = next;
  listeners.forEach((l) => l());
  // Typing in a name saves after a short pause, not on every letter.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveJSON(StorageKeys.skips, rules), 400);
}

export function loadSkipRules(): Promise<void> {
  loading ??= loadJSON<unknown>(StorageKeys.skips, []).then((saved) => {
    const ids = new Set(rules.map((r) => r.id));
    // Anything added before loading finished stays.
    rules = [...rules, ...normalizeRules(saved).filter((r) => !ids.has(r.id))];
    listeners.forEach((l) => l());
  });
  return loading;
}

export const newSkipButton = (label = DEFAULT_SKIP_LABEL, seconds: number = SKIP_SECONDS.default): SkipButton => ({ id: newId(), label, seconds });

/** Adds a rule for a series with one "Skip intro +90s" button; returns it. */
export function addSkipRule(match: string): SkipRule {
  const rule: SkipRule = { id: newId(), match, buttons: [newSkipButton()], updatedAt: Date.now() };
  emit([...rules, rule]);
  return rule;
}

export function updateSkipRule(id: string, change: Partial<Pick<SkipRule, 'match' | 'buttons'>>) {
  emit(
    rules.map((r) =>
      r.id === id ? { ...r, ...change, buttons: (change.buttons ?? r.buttons).map((b) => ({ ...b, seconds: clampSkipSeconds(b.seconds) })), updatedAt: Date.now() } : r,
    ),
  );
}

export function deleteSkipRule(id: string) {
  emit(rules.filter((r) => r.id !== id));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => rules;

export function useSkipRules(): SkipRule[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

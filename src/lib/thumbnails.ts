/**
 * Video thumbnails: one frame from 1 s in, made a few at a time and remembered between launches.
 */
import { File } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { useEffect, useState } from 'react';

import { loadJSON, saveJSON, StorageKeys } from './storage';

const cache = new Map<string, string>();
const waiting = new Map<string, ((uri: string | null) => void)[]>();
const queue: { id: string; uri: string; atMs: number }[] = [];
let running = 0;
const MAX_RUNNING = 3;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

let loading: Promise<void> | null = null;
function loadCache(): Promise<void> {
  loading ??= loadJSON<Record<string, string>>(StorageKeys.thumbnails, {}).then((saved) => {
    for (const [k, v] of Object.entries(saved ?? {})) {
      try {
        if (new File(v).exists) cache.set(k, v);
      } catch {
        // file gone (cache cleared)
      }
    }
  });
  return loading;
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const entries = [...cache.entries()].slice(-1500);
    void saveJSON(StorageKeys.thumbnails, Object.fromEntries(entries));
  }, 1500);
}

function pump() {
  while (running < MAX_RUNNING && queue.length) {
    const job = queue.shift()!;
    running++;
    getThumbnailAsync(job.uri, { time: job.atMs, quality: 0.6 })
      .then((r) => {
        cache.set(job.id, r.uri);
        persist();
        return r.uri;
      })
      .catch(() => null)
      .then((uri) => {
        running--;
        waiting.get(job.id)?.forEach((cb) => cb(uri));
        waiting.delete(job.id);
        pump();
      });
  }
}

function request(id: string, uri: string, atMs: number, cb: (uri: string | null) => void) {
  const list = waiting.get(id);
  if (list) {
    list.push(cb);
    return;
  }
  waiting.set(id, [cb]);
  queue.push({ id, uri, atMs });
  pump();
}

/** File URI of the thumbnail for a video, or null while it's being made (or if it can't be). */
export function useThumbnail(id: string, uri: string, durationMs: number): string | null {
  const [thumb, setThumb] = useState<string | null>(() => cache.get(id) ?? null);
  useEffect(() => {
    let alive = true;
    const at = durationMs > 3000 ? 1000 : 0;
    void loadCache().then(() => {
      if (!alive) return;
      const hit = cache.get(id);
      if (hit) setThumb(hit);
      else request(id, uri, at, (u) => alive && setThumb(u));
    });
    return () => {
      alive = false;
    };
  }, [id, uri, durationMs]);
  return thumb;
}

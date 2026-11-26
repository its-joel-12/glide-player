/** Pure rules for the video left open in the player (tested in tests/app.test.js). */
export type OpenVideo = { id: string; uri: string; title: string; width?: number; height?: number; durationMs?: number };

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined);

/** The saved value back as a video to open, or null when it is missing or not a video. */
export function openVideoFrom(saved: unknown): OpenVideo | null {
  if (!saved || typeof saved !== 'object') return null;
  const s = saved as Record<string, unknown>;
  if (typeof s.uri !== 'string' || !s.uri) return null;
  const id = typeof s.id === 'string' && s.id ? s.id : s.uri;
  const title = typeof s.title === 'string' && s.title ? s.title : 'Video';
  return { id, uri: s.uri, title, width: num(s.width), height: num(s.height), durationMs: num(s.durationMs) };
}

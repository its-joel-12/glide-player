/** Formatting helpers (pure; covered by tests/app.test.js). */

/** 75_000 → "1:15", 3_725_000 → "1:02:05". Negative or missing → "0:00". */
export function formatTime(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Signed offset for seek feedback: +10s, −1:05. */
export function formatOffset(ms: number): string {
  const sign = ms < 0 ? '−' : '+';
  const abs = Math.abs(ms);
  return abs < 60_000 ? `${sign}${Math.round(abs / 1000)}s` : `${sign}${formatTime(abs)}`;
}

/** Common name for a video size: 3840×2160 → "4K", 1920×1080 → "1080p", 1080×1920 (portrait) → "1080p". */
export function formatResolution(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) return '';
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short >= 2100 || long >= 3800) return '4K';
  if (short >= 1400 || long >= 2500) return '1440p';
  if (short >= 1000 || long >= 1900) return '1080p';
  if (short >= 700 || long >= 1260) return '720p';
  if (short >= 470) return '480p';
  return `${short}p`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(0.1, bytes / 1024 ** 2).toFixed(1)} MB`;
}

/** "Today", "Yesterday", "12 Oct" or "12 Oct 2024" (local time). */
export function formatDay(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${d.getDate()} ${months[d.getMonth()]}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** Frames per second for display: 23.976 → "23.98", 30 → "30", 119.88 → "120". */
export function formatFps(fps: number | null | undefined): string {
  if (!fps || !Number.isFinite(fps) || fps <= 0) return '–';
  if (fps >= 50) return String(Math.round(fps));
  return Math.abs(fps - Math.round(fps)) < 0.01 ? String(Math.round(fps)) : fps.toFixed(2);
}

/** File name without folders or extension, for titles. */
export function titleFromName(name: string | null | undefined): string {
  if (!name) return 'Video';
  const base = decodeURIComponent(name.split(/[\\/]/).pop() ?? name);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base) || 'Video';
}

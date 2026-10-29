/** Subtitle files for the web player: SubRip (.srt), WebVTT (.vtt) and basic ASS/SSA. Pure; tested. */

export type Cue = { start: number; end: number; text: string };

/** "00:01:02,500" / "01:02.5" / "0:01:02.50" → seconds. */
export function parseTimestamp(s: string): number {
  const parts = s.trim().replace(',', '.').split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return NaN;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const stripTags = (t: string) =>
  t
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\\N/gi, '\n')
    .trim();

/** Parses .srt or .vtt text (detected from the content). */
export function parseSrtOrVtt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const start = parseTimestamp(a);
    const end = parseTimestamp(b.trim().split(/\s+/)[0]);
    const body = stripTags(lines.slice(i + 1).join('\n'));
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Parses the [Events] Dialogue lines of an .ass/.ssa file. */
export function parseAss(text: string): Cue[] {
  const cues: Cue[] = [];
  let fields: string[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (/^Format:/i.test(line)) fields = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
    if (!/^Dialogue:/i.test(line) || !fields.length) continue;
    const values = line.slice(9).split(',');
    const textIndex = fields.indexOf('text');
    const get = (name: string) => values[fields.indexOf(name)]?.trim() ?? '';
    const body = stripTags(values.slice(textIndex).join(','));
    const start = parseTimestamp(get('start'));
    const end = parseTimestamp(get('end'));
    if (Number.isFinite(start) && Number.isFinite(end) && body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

export function parseSubtitles(text: string, name = ''): Cue[] {
  if (/\.(ass|ssa)$/i.test(name) || /^\[Script Info\]/m.test(text)) return parseAss(text);
  return parseSrtOrVtt(text);
}

/** Text to show at time t (overlapping cues are joined). */
export function cueAt(cues: Cue[], t: number): string {
  let out = '';
  for (const c of cues) {
    if (c.start > t) break;
    if (t < c.end) out = out ? `${out}\n${c.text}` : c.text;
  }
  return out;
}

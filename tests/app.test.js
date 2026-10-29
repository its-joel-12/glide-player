// Tests for src/lib (formatting, frame timing, resume rules, gestures, settings). Run: npm test
require('./register-ts');
const f = require('../src/lib/format.ts');
const c = require('../src/lib/cadence.ts');
const r = require('../src/lib/resume-rules.ts');
const g = require('../src/lib/gestures.ts');
const s = require('../src/lib/settings-schema.ts');
let fails = 0;
const eq = (a, b, m) => {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) fails++;
  console.log(ok ? 'ok  ' : 'FAIL', m, ok ? '' : `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
};
const near = (a, b, tol, m) => eq(Math.abs(a - b) <= tol, true, `${m} (${a} ≈ ${b})`);

// format
eq(f.formatTime(0), '0:00', 'time 0');
eq(f.formatTime(75_000), '1:15', 'time 1:15');
eq(f.formatTime(3_725_000), '1:02:05', 'time hours');
eq(f.formatTime(-5), '0:00', 'time negative');
eq(f.formatOffset(10_000), '+10s', 'offset +10s');
eq(f.formatOffset(-65_000), '−1:05', 'offset -1:05');
eq(f.formatResolution(3840, 2160), '4K', '4K');
eq(f.formatResolution(1920, 1080), '1080p', '1080p');
eq(f.formatResolution(1080, 1920), '1080p', 'portrait 1080p');
eq(f.formatResolution(1280, 720), '720p', '720p');
eq(f.formatResolution(0, 0), '', 'unknown size');
eq(f.formatFps(23.976), '23.98', 'fps 23.976');
eq(f.formatFps(30), '30', 'fps 30');
eq(f.formatFps(119.88), '120', 'fps 119.88');
eq(f.formatBytes(1.5 * 1024 ** 3), '1.5 GB', 'bytes GB');
eq(f.titleFromName('Movies/Holiday%20clip.mp4'), 'Holiday clip', 'title from name');
const now = new Date(2026, 9, 29, 12).getTime();
eq(f.formatDay(new Date(2026, 9, 29, 8).getTime(), now), 'Today', 'day today');
eq(f.formatDay(new Date(2026, 9, 28, 23).getTime(), now), 'Yesterday', 'day yesterday');
eq(f.formatDay(new Date(2026, 9, 12).getTime(), now), '12 Oct', 'day this year');
eq(f.formatDay(new Date(2025, 0, 3).getTime(), now), '3 Jan 2025', 'day other year');

// cadence: 24 fps → 120 Hz makes 4 in-between frames per pair, evenly spaced
const gap24 = 1_000_000 / 24;
eq(c.inBetweenTimes(0, gap24, 120), [8333, 16667, 25000, 33333], '24→120 grid');
eq(c.inBetweenTimes(0, gap24, 60).length, 2, '24→60: 2 in-betweens');
eq(c.inBetweenTimes(0, gap24, 24).length, 0, 'same rate: none');
eq(c.inBetweenTimes(0, gap24, 120, 0.5).length, 9, 'half speed: 9 in-betweens');
eq(c.inBetweenTimes(500, 400, 120), [], 'backwards: none');
near(c.outputRate(24, 120), 120, 0.5, 'output 24→120');
near(c.outputRate(30, 60), 60, 0.5, 'output 30→60');
near(c.outputRate(25, 60), 60, 3, 'output 25→60 roughly 60');
near(c.outputRate(24, 120, 0.25), 120, 1, 'quarter speed still fills 120 Hz of real time');
// times strictly increase and stay inside the pair
const big = c.inBetweenTimes(1_000_000_000_000, 1_000_000_000_000 + gap24, 144);
eq(big.every((t, i) => t > 1e12 && t < 1e12 + gap24 && (i === 0 || t > big[i - 1])), true, 'large timestamps (ExoPlayer offset) stay ordered');
const plan = c.planExport(10_000, 30, 60, 4, 1920, 1080);
eq(plan.durationMs, 40_000, 'export slow-mo length');
near(plan.frames, 2400, 30, 'export frames 40 s × 60 fps');
near(plan.generatedShare, 0.875, 0.02, 'export: 7 of 8 frames made up');
const smooth = c.planExport(60_000, 30, 120, 1, 1920, 1080);
near(smooth.frames, 7200, 60, 'smooth export frames');
near(smooth.generatedShare, 0.75, 0.02, 'smooth export 75% made up');

// resume rules
const E = (p, d, t = 1) => ({ positionMs: p, durationMs: d, updatedAt: t, title: 'x', uri: 'u' });
eq(r.startPosition(undefined), 0, 'no entry → start');
eq(r.startPosition(E(3_000, 600_000)), 0, 'barely started → start');
eq(r.startPosition(E(120_000, 600_000)), 118_000, 'resume a bit earlier');
eq(r.startPosition(E(595_000, 600_000)), 0, 'nearly finished → start');
eq(r.progressFraction(E(300_000, 600_000)), 0.5, 'progress half');
const cw = r.continueWatching({ a: E(120_000, 600_000, 5), b: E(1_000, 600_000, 9), c: E(300_000, 600_000, 7) });
eq(cw.map((e) => e.id), ['c', 'a'], 'continue watching order + filter');
const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`v${i}`, E(60_000, 600_000, i)]));
eq(Object.keys(r.pruneEntries(many, 3)).sort(), ['v2', 'v3', 'v4'], 'prune keeps newest');

// gestures
eq(g.seekOffsetForSwipe(0, 800, 600_000), 0, 'no swipe no seek');
eq(g.seekOffsetForSwipe(800, 800, 600_000), 90_000, 'full swipe 90 s');
eq(g.seekOffsetForSwipe(-800, 800, 30_000), -30_000, 'short video: whole length');
eq(g.seekOffsetForSwipe(400, 800, 600_000) < 45_000, true, 'finer near the start');
near(g.levelForSwipe(0.5, -100, 1000), 0.62, 0.001, 'swipe up raises');
eq(g.levelForSwipe(0.9, -1000, 1000), 1, 'clamped at 1');
eq(g.sideOf(10, 1000), 'left', 'left side');
eq(g.sideOf(500, 1000), 'center', 'center');
eq(g.sideOf(990, 1000), 'right', 'right side');
eq(g.resizeForPinch(1.4, 'fit'), 'zoom', 'pinch out fills');
eq(g.resizeForPinch(0.7, 'zoom'), 'fit', 'pinch in fits');

// settings
eq(s.normalizePreferences(null), s.DefaultPreferences, 'defaults');
eq(s.normalizePreferences({ mode: 'blend', targetFps: 120, quality: 'nope', seekStep: 7, pip: false }).mode, 'blend', 'keeps valid mode');
eq(s.normalizePreferences({ targetFps: 75 }).targetFps, 0, 'unknown fps → auto');
eq(s.normalizePreferences({ quality: 'nope' }).quality, 'balanced', 'bad quality → default');
eq(s.normalizePreferences({ seekStep: 7 }).seekStep, 10, 'bad seek step → default');
eq(s.normalizePreferences({ pip: false }).pip, false, 'keeps pip off');

// web subtitles
const sub = require('../modules/glide-engine/src/web/subtitles.ts');
eq(sub.parseTimestamp('00:01:02,500'), 62.5, 'srt timestamp');
eq(sub.parseTimestamp('01:02.250'), 62.25, 'vtt short timestamp');
const srt = sub.parseSrtOrVtt('1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nthere\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye\r\n');
eq(srt, [{ start: 1, end: 2.5, text: 'Hello\nthere' }, { start: 3, end: 4, text: 'Bye' }], 'parse srt (CRLF, tags)');
const vtt = sub.parseSubtitles('WEBVTT\n\n00:00.500 --> 00:01.500 align:center\nHi', 'a.vtt');
eq(vtt, [{ start: 0.5, end: 1.5, text: 'Hi' }], 'parse vtt with settings');
const ass = sub.parseSubtitles('[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\b1}Bold, yes\\Nline two', 'a.ass');
eq(ass, [{ start: 1, end: 2, text: 'Bold, yes\nline two' }], 'parse ass (commas, tags, \\N)');
eq(sub.cueAt(srt, 1.2), 'Hello\nthere', 'cue at 1.2');
eq(sub.cueAt(srt, 2.7), '', 'no cue between');

// video grid helpers (the library list)
const grid = require('../src/lib/grid.ts');
const vids = (...ids) => ids.map((id) => ({ id }));
eq(grid.mergeUnique(vids('a', 'b'), vids('b', 'c')).map((v) => v.id), ['a', 'b', 'c'], 'merge skips duplicates');
eq(grid.mergeUnique([], vids('a', 'a')).map((v) => v.id), ['a'], 'merge dedupes inside a page');
eq(grid.toRows([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], 'rows of 2');
eq(grid.toRows([], 3), [], 'no rows');
eq(grid.toRows([1, 2], 0), [[1], [2]], 'zero columns → 1');
eq(grid.columnsFor(360), 2, 'phone: 2 columns');
eq(grid.columnsFor(1200), 6, 'wide: 6 columns');
eq(grid.columnsFor(100), 2, 'never below 2');

// subtitle style + delays
const ss = s.normalizeSubtitleStyle({ scale: 9, font: 'comic', color: '#ff0000', background: 'band', backgroundOpacity: -1, position: 'x' });
eq([ss.scale, ss.font, ss.color, ss.background, ss.backgroundOpacity, ss.position], [2.5, 'sans', '#FF0000', 'band', 0, 0.08], 'subtitle style clamps and fills defaults');
eq(s.normalizeSubtitleStyle(null), s.DefaultSubtitleStyle, 'missing subtitle style → defaults');
eq(s.normalizePreferences({}).subtitleStyle, s.DefaultSubtitleStyle, 'old saved settings get a subtitle style');
eq(s.formatDelay(150), '+150 ms', 'delay +150 ms');
eq(s.formatDelay(-1250), '−1.25 s', 'delay −1.25 s');
eq(s.formatDelay(-1000), '−1 s', 'delay −1 s');
eq(s.formatDelay(2500), '+2.5 s', 'delay +2.5 s');
eq(s.formatDelay(0.2), '0 ms', 'delay 0');
const subCss = require('../modules/glide-engine/src/web/subtitle-style.ts');
eq(subCss.rgba('#FF8000', 0.5), 'rgba(255, 128, 0, 0.5)', 'rgba');
const css = subCss.subtitleCss({ ...subCss.DEFAULT_SUBTITLE_STYLE, background: 'box', backgroundOpacity: 1, scale: 1.3, position: 0.16 });
eq([css.box.bottom, css.text.background], ['16%', 'rgba(0, 0, 0, 1)'], 'box background + position');
eq(css.box.fontSize.includes('1.3'), true, 'size scales the font');
eq(subCss.subtitleCss({ ...subCss.DEFAULT_SUBTITLE_STYLE, edge: 'none' }).text.textShadow, 'none', 'no edge → no shadow');

// the web engine uses the same shaders as the Android engine
const fs = require('fs');
const kt = fs.readFileSync(require('path').join(__dirname, '../modules/glide-engine/android/src/main/java/expo/modules/glide/memc/Shaders.kt'), 'utf8');
const web = require('../modules/glide-engine/src/web/shaders.ts');
const ktShaders = Object.fromEntries([...kt.matchAll(/const val (\w+) = """([\s\S]*?)"""/g)].map((m) => [m[1], m[2]]));
eq(Object.keys(ktShaders).sort(), Object.keys(web).sort(), 'same shader list on Android and web');
eq(Object.keys(ktShaders).every((k) => ktShaders[k] === web[k]), true, 'shader sources identical on Android and web');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

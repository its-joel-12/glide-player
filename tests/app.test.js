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

// seeking in long files / files with an unknown duration
eq(f.seekTarget(7_300_000, 8_400_000), 7_300_000, '2h20m video: jump to 2:01:40 stays there');
eq(f.seekTarget(9_000_000, 8_400_000), 8_399_500, 'past the end → just before the end');
eq(f.seekTarget(5_400_000, 0), 5_400_000, 'unknown duration: seek is NOT clamped to 0');
eq(f.seekTarget(-10_000, 0), 0, 'never below 0');
eq(f.containerLabel('video/x-matroska'), 'MKV', 'MKV label');
eq(f.containerLabel('video/mp4'), 'MP4', 'MP4 label');
eq(f.containerLabel('video/x-something'), 'SOMETHING', 'unknown container label');
eq(f.containerLabel(''), '', 'no container');
eq(r.startPosition({ positionMs: 6_000_000, durationMs: 8_400_000, updatedAt: 0, title: '', uri: '' }), 5_998_000, 'resume works for a 2h20m video');

// subtitle files saved with a seekable copy are found whichever way the gallery names it
const mk = require('../src/lib/media-key.ts');
eq(mk.sidecarKey('content://media/external_primary/video/media/42'), 'media:42', 'gallery uri → id key');
eq(mk.sidecarKey('content://media/external/video/media/42'), 'media:42', 'same video, other volume name');
eq(mk.sidecarKey('42'), 'media:42', 'bare id');
eq(mk.sidecarKey('file:///x/y.mp4'), 'file:///x/y.mp4', 'other uris unchanged');

// press and hold for fast playback
eq(g.holdSpeedFor(2, 0), 2, 'hold starts at the chosen speed');
eq(g.holdSpeedFor(2, 80), 3, 'slide right → faster');
eq(g.holdSpeedFor(2, -80), 1.5, 'slide left → slower');
eq(g.holdSpeedFor(2, 500), 3, 'never above 3×');
eq(g.holdSpeedFor(1.5, -500), 1.5, 'never below 1.5×');
eq(g.holdSpeedFor(2, 30), 2, 'small slides keep the speed');
eq(s.normalizePreferences({}).holdSpeed, 2, 'hold speed 2× by default');
eq(s.normalizePreferences({ holdSpeed: 5 }).holdSpeed, 2, 'bad hold speed → 2×');
eq(s.normalizePreferences({ holdToSpeed: false }).holdToSpeed, false, 'hold can be turned off');

// library sorting and "watched"
const ls = require('../src/lib/library-sort.ts');
const lib = [
  { id: 'a', title: 'Episode 10', durationMs: 1_400_000, modifiedAt: 3 },
  { id: 'b', title: 'episode 2', durationMs: 7_200_000, modifiedAt: 1 },
  { id: 'c', title: 'Zoo trip', durationMs: 60_000, modifiedAt: 2 },
];
const ids = (l) => l.map((v) => v.id).join('');
eq(ids(ls.sortVideos(lib, 'newest')), 'acb', 'sort newest');
eq(ids(ls.sortVideos(lib, 'oldest')), 'bca', 'sort oldest');
eq(ids(ls.sortVideos(lib, 'name')), 'bac', 'sort name: numbers in order, case ignored');
eq(ids(ls.sortVideos(lib, 'nameDesc')), 'cab', 'sort name Z–A');
eq(ids(ls.sortVideos(lib, 'longest')), 'bac', 'sort longest');
eq(ids(ls.sortVideos(lib, 'shortest')), 'cab', 'sort shortest');
eq(ids(lib), 'abc', 'sorting leaves the original alone');
const sr = require('../src/lib/library-search.ts');
eq(sr.normalizeForSearch('The.Matrix_(1999)-1080p'), 'the matrix 1999 1080p', 'search: separators become spaces');
eq(sr.normalizeForSearch('Amélie Café'), 'amelie cafe', 'search: accents ignored');
eq(sr.queryWords('  '), [], 'search: blank query has no words');
const films = [
  { id: 'm', title: 'The.Matrix.1999.1080p' },
  { id: 'r', title: 'Matrix Reloaded 720p' },
  { id: 'a', title: 'Amélie (2001)' },
  { id: 'v', title: 'VID_20261103_101500' },
];
eq(ids(sr.searchVideos(films, '')), 'mrav', 'search: empty query keeps everything in order');
eq(ids(sr.searchVideos(films, 'MATRIX')), 'mr', 'search: case ignored');
eq(ids(sr.searchVideos(films, '1080 matrix')), 'm', 'search: every word, any order');
eq(ids(sr.searchVideos(films, 'amelie')), 'a', 'search: accent-free query finds accented name');
eq(ids(sr.searchVideos(films, 'vid 2026')), 'v', 'search: underscores split words');
eq(ids(sr.searchVideos(films, 'matrix 4k')), '', 'search: no match');
eq(r.isFinished(7_150_000, 7_200_000), true, 'in the credits → watched');
eq(r.isFinished(3_600_000, 7_200_000), false, 'halfway → not watched');
eq(r.isFinished(5_000, 0), false, 'unknown length → not watched');
eq(s.normalizePreferences({}).libraryView, 'grid', 'grid view by default');
eq(s.normalizePreferences({ librarySort: 'name', libraryView: 'list' }).librarySort, 'name', 'saved sort kept');
eq(s.normalizePreferences({ librarySort: 'size' }).librarySort, 'newest', 'unknown sort → newest');

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
eq([s.normalizePreferences({}).gestureBrightness, s.normalizePreferences({}).gestureVolume], [true, true], 'swipe gestures on by default');
eq(s.normalizePreferences({ gestureBrightness: false, gestureVolume: 'no' }).gestureBrightness, false, 'brightness swipe can be turned off');
eq(s.normalizePreferences({ gestureVolume: 'no' }).gestureVolume, true, 'bad saved value → default');
eq([s.normalizePreferences({}).audioDelayMs, s.normalizePreferences({}).subtitleDelayMs], [0, 0], 'no default delays at first');
eq(s.normalizePreferences({ audioDelayMs: 150.4, subtitleDelayMs: -1250 }).audioDelayMs, 150, 'saved audio delay kept (whole ms)');
eq(s.normalizePreferences({ audioDelayMs: 99999, subtitleDelayMs: -99999 }).subtitleDelayMs, -60000, 'subtitle delay clamped');
eq(s.clampDelay(99999, s.AUDIO_DELAY_RANGE), 5000, 'audio delay clamped');
eq(s.clampDelay('x', s.AUDIO_DELAY_RANGE), 0, 'bad delay → 0');
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

// live upscaling: output size and settings
const eng = require('../modules/glide-engine/src/web/engine.ts');
eq(eng.upscaleSize(640, 360, 1920, 1080), [1920, 1080], '360p on a 1080p screen → 1080p');
eq(eng.upscaleSize(480, 360, 2400, 1080), [1440, 1080], '4:3 fits by height');
eq(eng.upscaleSize(160, 90, 2560, 1440), [640, 360], 'at most 4×');
eq(eng.upscaleSize(1920, 1080, 2400, 1080), [1920, 1080], 'already as big as the screen → unchanged');
eq(eng.upscaleSize(1280, 720, 1400, 788), [1280, 720], 'less than 1.15× → unchanged');
eq(eng.upscaleSize(1280, 720, 3840, 2160), [3840, 2160], '720p on a 4K screen → 4K');
eq(eng.upscaleSize(1000, 1000, 8000, 8000).every((v) => v % 2 === 0) && eng.upscaleSize(1000, 1000, 8000, 8000)[0] * eng.upscaleSize(1000, 1000, 8000, 8000)[1] <= 3840 * 2160 + 4000, true, 'capped near 4K pixels, even sizes');
eq(eng.upscaleSize(640, 360, 0, 0), [640, 360], 'unknown screen → unchanged');
eq(eng.upscaleSize(641, 361, 1920, 1080).every((v) => v % 2 === 0), true, 'odd sizes rounded to even');
const upKt = fs.readFileSync(require('path').join(__dirname, '../modules/glide-engine/android/src/main/java/expo/modules/glide/upscale/LiveUpscaler.kt'), 'utf8');
const ktConst = (n) => Number(eval(upKt.match(new RegExp(`const val ${n} = ([^\\n]+)`))[1].replace(/L/g, '').replace(/f$/, '')));
eq([ktConst('MAX_SCALE'), ktConst('MIN_SCALE'), ktConst('MAX_OUTPUT_PIXELS')], [eng.UPSCALE_MAX_SCALE, eng.UPSCALE_MIN_SCALE, eng.UPSCALE_MAX_OUTPUT_PIXELS], 'upscale limits identical on Android and web');
eq([s.normalizePreferences({}).upscale, s.normalizePreferences({}).sharpness], [false, 0.5], 'upscaling off, medium sharpening by default');
eq(s.normalizePreferences({ upscale: true, sharpness: 0.8 }).sharpness, 0.8, 'saved sharpness kept');
eq(s.normalizePreferences({ upscale: 'yes', sharpness: 0.7 }), { ...s.DefaultPreferences }, 'bad upscale values → defaults');

// AI upscaling for saved copies: tiles and output size
const up = require('../src/lib/upscale-plan.ts');
eq(up.upscaledSize(480, 270, 4), [1920, 1080], '270p ×4 → 1080p');
eq(up.upscaledSize(1280, 720, 4), [3840, 2160], '720p ×4 capped to 4K');
eq(up.upscaledSize(1920, 1080, 2), [3840, 2160], '1080p ×2 → 4K');
eq(up.upscaledSize(3840, 2160, 2), null, '4K can\'t go bigger');
eq(up.upscaledSize(640, 480, 2), [1280, 960], '480p ×2');
eq(up.upscaledSize(1080, 1920, 4), [2160, 3840], 'portrait capped to 4K');
eq(up.tileCount(480, 270), 6, '270p: 3×2 tiles of 168 px');
eq(up.canUpscale(1920, 1080), false, 'the network runs on up to 1280 px wide (or tall) videos');
eq(up.canUpscale(1280, 720), true, '720p can be AI-upscaled');
const nKt = fs.readFileSync(require('path').join(__dirname, '../modules/glide-engine/android/src/main/java/expo/modules/glide/upscale/NeuralUpscaler.kt'), 'utf8');
const nConst = (n) => Number(nKt.match(new RegExp(`const val ${n} = ([0-9.]+)`))[1]);
eq(
  ['MODEL_SCALE', 'TILE', 'PAD', 'MAX_INPUT_LONG', 'MAX_INPUT_SHORT', 'MAX_OUTPUT_LONG', 'MAX_OUTPUT_SHORT', 'MIN_GAIN'].map(nConst),
  [up.NEURAL_SCALE, up.NEURAL_TILE, up.NEURAL_PAD, up.MAX_INPUT_LONG, up.MAX_INPUT_SHORT, up.MAX_OUTPUT_LONG, up.MAX_OUTPUT_SHORT, up.MIN_GAIN],
  'AI upscaling limits identical on Android and in the app',
);
eq(fs.existsSync(require('path').join(__dirname, '../modules/glide-engine/android/src/main/assets/glide-sr-x4.tflite')), true, 'upscaling model is bundled');

// FFmpeg audio decoder: the copied Media3 sources match the Media3 version the app uses
{
  const path = require('path');
  const gradle = fs.readFileSync(path.join(__dirname, '../modules/glide-engine/android/build.gradle'), 'utf8');
  const lib = fs.readFileSync(path.join(__dirname, '../modules/glide-engine/android/src/main/java/androidx/media3/decoder/ffmpeg/FfmpegLibrary.java'), 'utf8');
  eq((lib.match(/vendored from androidx\/media ([\d.]+)/) || [])[1], (gradle.match(/media3Version = "([\d.]+)"/) || [])[1], 'FFmpeg decoder copied from the same Media3 version');
  const decoders = fs.readFileSync(path.join(__dirname, '../scripts/ffmpeg/build.sh'), 'utf8').match(/DECODERS=\(([^)]*)\)/)[1].split(/\s+/);
  eq(['ac3', 'eac3', 'truehd', 'dca'].every((d) => decoders.includes(d)), true, 'FFmpeg build has the Dolby/DTS decoders');
}

// selection (multi-select in the library)
const sel = require('../src/lib/selection.ts');
const picks = (s) => (s ? [...s].sort() : s);
eq(picks(sel.toggleSelected(null, 'a')), ['a'], 'long-press starts selecting with that video');
eq(picks(sel.toggleSelected(new Set(['a']), 'b')), ['a', 'b'], 'tap adds');
eq(sel.toggleSelected(new Set(['a']), 'a'), null, 'unpicking the last one ends selecting');
eq(picks(sel.selectAllToggle(new Set(['a']), ['a', 'b', 'c'])), ['a', 'b', 'c'], 'select all');
eq(picks(sel.selectAllToggle(new Set(['a', 'b']), ['a', 'b'])), [], 'select all again unpicks, still selecting');
eq(picks(sel.pruneSelection(new Set(['a', 'gone']), ['a', 'b'])), ['a'], 'refresh drops missing videos');
const same = new Set(['a']);
eq(sel.pruneSelection(same, ['a']) === same, true, 'prune keeps the same object when nothing changed');
eq(sel.pruneSelection(null, ['a']), null, 'prune while not selecting');

// remembered audio/subtitle tracks
const tm = require('../src/lib/track-memory-rules.ts');
const T = (id, label, language, selected = false, unsupported) => ({ id, label, language, selected, ...(unsupported ? { unsupported } : {}) });
const audio = [T('1:0', 'English · 5.1', 'en', true), T('2:0', 'Hindi · Stereo', 'hi'), T('3:0', 'English · Stereo', 'en')];
eq(tm.pickOf(audio, '2:0'), { label: 'Hindi · Stereo', language: 'hi', index: 1 }, 'pick remembers name, language and place');
eq(tm.pickOf(audio, 'x'), undefined, 'unknown id');
eq(tm.restoreChoice(audio, { label: 'Hindi · Stereo', language: 'hi', index: 1 }), '2:0', 'puts the picked audio back');
eq(tm.restoreChoice(audio, { label: 'English · 5.1', language: 'en', index: 0 }), undefined, 'already selected: nothing to do');
eq(tm.restoreChoice(audio, undefined), undefined, 'nothing remembered');
const moved = [T('0:0', 'English · 5.1', 'en', true), T('4:0', 'Hindi · Stereo', 'hi')];
eq(tm.restoreChoice(moved, { label: 'Hindi · Stereo', language: 'hi', index: 1 }), '4:0', 'found by name when ids change');
eq(tm.restoreChoice(audio, { label: 'English · Stereo', language: 'en', index: 2 }), '3:0', 'same name+language: the right one of two English tracks');
eq(tm.restoreChoice([T('1:0', 'Audio 1', 'en', true), T('2:0', 'Audio 2', 'ta')], { label: 'Tamil', language: 'ta', index: 1 }), '2:0', 'falls back to language');
eq(tm.restoreChoice([T('1:0', 'A', 'en', true), T('2:0', 'DTS', 'hi', false, 'DTS can\'t be played')], { label: 'DTS', language: 'hi', index: 1 }), undefined, 'never switches to unplayable sound');
const subs = [T('5:0', 'English', 'en', true), T('6:0', 'movie.srt', '')];
eq(tm.restoreChoice(subs, 'off'), null, 'subtitles switched off again');
eq(tm.restoreChoice([T('5:0', 'English', 'en')], 'off'), undefined, 'already off');
eq(tm.restoreChoice(subs, { label: 'movie.srt', language: '', index: -1 }), '6:0', 'added subtitle file found by name');
eq(tm.restoreChoice([], { label: 'movie.srt', language: '', index: 0 }), undefined, 'no tracks yet');
eq(Object.keys(tm.pruneMemory({ a: { updatedAt: 1 }, b: { updatedAt: 3 }, c: { updatedAt: 2 } }, 2)).sort(), ['b', 'c'], 'prune keeps the newest');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);

/** Saved settings and how to read them back safely (no React Native imports: used by tests too). */
import type { SubtitleStyle } from '../../modules/glide-engine/src/GlideEngine.types';
import type { LibrarySort, LibraryView } from './library-sort';

export type { SubtitleStyle };

export type ThemePreference = 'system' | 'light' | 'dark';
export type SmoothingMode = 'off' | 'blend' | 'memc';
export type AnalysisQuality = 'fast' | 'balanced' | 'detailed';

export type Preferences = {
  theme: ThemePreference;
  /** Smoothing a video starts with. */
  mode: SmoothingMode;
  /** Output frames per second; 0 = the screen's highest refresh rate. */
  targetFps: number;
  quality: AnalysisQuality;
  /** Frames-per-second readout on the player. */
  showStats: boolean;
  /** Go into picture-in-picture when leaving the app during playback. */
  pip: boolean;
  /** Keep the sound playing when the app is in the background. */
  backgroundAudio: boolean;
  /** Start videos where they were left. */
  resume: boolean;
  /** Seconds for double-tap seek. */
  seekStep: number;
  /** Turn the phone sideways for wide videos. */
  autoRotate: boolean;
  /** Swipe up/down on the left half for brightness (web: volume). */
  gestureBrightness: boolean;
  /** Swipe up/down on the right half for volume. */
  gestureVolume: boolean;
  /** Press and hold the video to play faster while the finger is down. */
  holdToSpeed: boolean;
  /** Speed for press-and-hold (1.5, 2 or 3). */
  holdSpeed: number;
  /** Videos tab: big thumbnails or a list. */
  libraryView: LibraryView;
  librarySort: LibrarySort;
  subtitleStyle: SubtitleStyle;
  /** Audio delay every video starts with (ms; + = sound later). */
  audioDelayMs: number;
  /** Subtitle delay every video starts with (ms; + = subtitles later). */
  subtitleDelayMs: number;
};

export const DefaultSubtitleStyle: SubtitleStyle = {
  scale: 1,
  font: 'sans',
  bold: false,
  color: '#FFFFFF',
  background: 'none',
  backgroundColor: '#000000',
  backgroundOpacity: 0.5,
  edge: 'outline',
  edgeColor: '#000000',
  position: 0.08,
  useFileStyles: true,
};

export const DefaultPreferences: Preferences = {
  theme: 'system',
  mode: 'memc',
  targetFps: 0,
  quality: 'balanced',
  showStats: false,
  pip: true,
  backgroundAudio: false,
  resume: true,
  seekStep: 10,
  autoRotate: true,
  gestureBrightness: true,
  gestureVolume: true,
  holdToSpeed: true,
  holdSpeed: 2,
  libraryView: 'grid',
  librarySort: 'newest',
  subtitleStyle: DefaultSubtitleStyle,
  audioDelayMs: 0,
  subtitleDelayMs: 0,
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export const TargetFpsOptions = [0, 60, 90, 120, 144] as const;
export const SeekStepOptions = [5, 10, 15, 30] as const;
export const HoldSpeedOptions = [1.5, 2, 3] as const;

const hexColor = (value: unknown, fallback: string) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback);
const num = (value: unknown, lo: number, hi: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

export function normalizeSubtitleStyle(saved: unknown): SubtitleStyle {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const d = DefaultSubtitleStyle;
  return {
    scale: num(s.scale, 0.5, 2.5, d.scale),
    font: oneOf(s.font, ['sans', 'serif', 'mono', 'condensed', 'casual'] as const, d.font),
    bold: bool(s.bold, d.bold),
    color: hexColor(s.color, d.color),
    background: oneOf(s.background, ['none', 'box', 'band'] as const, d.background),
    backgroundColor: hexColor(s.backgroundColor, d.backgroundColor),
    backgroundOpacity: num(s.backgroundOpacity, 0, 1, d.backgroundOpacity),
    edge: oneOf(s.edge, ['none', 'outline', 'shadow', 'raised', 'depressed'] as const, d.edge),
    edgeColor: hexColor(s.edgeColor, d.edgeColor),
    position: num(s.position, 0, 0.4, d.position),
    useFileStyles: bool(s.useFileStyles, d.useFileStyles),
  };
}

/** Steps for audio/subtitle delay buttons and keys (ms), like VLC. */
export const DELAY_STEP_MS = 50;
export const AUDIO_DELAY_RANGE = { min: -5000, max: 5000 } as const;
export const SUBTITLE_DELAY_RANGE = { min: -60000, max: 60000 } as const;
/** The browser can only hold the picture back so far, so sound can't come more than 0.5 s early there. */
export const WEB_MIN_AUDIO_DELAY_MS = -500;

/** A delay rounded to whole ms and kept in range (non-numbers → 0). */
export function clampDelay(ms: unknown, range: { min: number; max: number }): number {
  return typeof ms === 'number' && Number.isFinite(ms) ? Math.min(range.max, Math.max(range.min, Math.round(ms))) : 0;
}

/** "+150 ms", "−1.25 s", "0 ms". */
export function formatDelay(ms: number): string {
  const r = Math.round(ms);
  if (r === 0) return '0 ms';
  const sign = r > 0 ? '+' : '−';
  const a = Math.abs(r);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 2).replace(/0$/, '')} s` : `${sign}${a} ms`;
}

/** Reads saved settings, dropping anything unknown or out of range. */
export function normalizePreferences(saved: unknown): Preferences {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const d = DefaultPreferences;
  return {
    theme: oneOf(s.theme, ['system', 'light', 'dark'] as const, d.theme),
    mode: oneOf(s.mode, ['off', 'blend', 'memc'] as const, d.mode),
    targetFps: (TargetFpsOptions as readonly number[]).includes(s.targetFps as number) ? (s.targetFps as number) : d.targetFps,
    quality: oneOf(s.quality, ['fast', 'balanced', 'detailed'] as const, d.quality),
    showStats: bool(s.showStats, d.showStats),
    pip: bool(s.pip, d.pip),
    backgroundAudio: bool(s.backgroundAudio, d.backgroundAudio),
    resume: bool(s.resume, d.resume),
    seekStep: (SeekStepOptions as readonly number[]).includes(s.seekStep as number) ? (s.seekStep as number) : d.seekStep,
    autoRotate: bool(s.autoRotate, d.autoRotate),
    gestureBrightness: bool(s.gestureBrightness, d.gestureBrightness),
    gestureVolume: bool(s.gestureVolume, d.gestureVolume),
    holdToSpeed: bool(s.holdToSpeed, d.holdToSpeed),
    holdSpeed: (HoldSpeedOptions as readonly number[]).includes(s.holdSpeed as number) ? (s.holdSpeed as number) : d.holdSpeed,
    libraryView: oneOf(s.libraryView, ['grid', 'list'] as const, d.libraryView),
    librarySort: oneOf(s.librarySort, ['newest', 'oldest', 'name', 'nameDesc', 'longest', 'shortest'] as const, d.librarySort),
    subtitleStyle: normalizeSubtitleStyle(s.subtitleStyle),
    audioDelayMs: clampDelay(s.audioDelayMs, AUDIO_DELAY_RANGE),
    subtitleDelayMs: clampDelay(s.subtitleDelayMs, SUBTITLE_DELAY_RANGE),
  };
}

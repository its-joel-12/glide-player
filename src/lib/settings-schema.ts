/** Saved settings and how to read them back safely (no React Native imports: used by tests too). */

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
};

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export const TargetFpsOptions = [0, 60, 90, 120, 144] as const;
export const SeekStepOptions = [5, 10, 15, 30] as const;

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
  };
}

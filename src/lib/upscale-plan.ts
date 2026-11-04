/**
 * AI upscaling for saved copies: which videos it works on, how big the copy gets, and how much work
 * it is. Mirrors NeuralPlan in the Android engine (upscale/NeuralUpscaler.kt); tests check they match.
 * No React Native imports (used by tests too).
 */

/** The network makes pictures this many times bigger. */
export const NEURAL_SCALE = 4;
/** The network's input is a fixed tile; NEURAL_PAD pixels on each side are context only. */
export const NEURAL_TILE = 192;
export const NEURAL_PAD = 12;
export const NEURAL_CORE = NEURAL_TILE - 2 * NEURAL_PAD;
/** Largest video the network is run on. */
export const MAX_INPUT_LONG = 1280;
export const MAX_INPUT_SHORT = 720;
/** Largest saved copy. */
export const MAX_OUTPUT_LONG = 3840;
export const MAX_OUTPUT_SHORT = 2160;
/** Below this it isn't worth it. */
export const MIN_GAIN = 1.25;

/** True when the video is small enough for the network (up to 1280×720, either way round). */
export function canUpscale(w: number, h: number): boolean {
  return w > 0 && h > 0 && Math.max(w, h) <= MAX_INPUT_LONG && Math.min(w, h) <= MAX_INPUT_SHORT;
}

/** Size of the copy for factor 2 or 4, capped at 4K; null when it wouldn't get bigger. */
export function upscaledSize(w: number, h: number, factor: number): [number, number] | null {
  if (w <= 0 || h <= 0) return null;
  const scale = Math.min(factor, MAX_OUTPUT_LONG / Math.max(w, h), MAX_OUTPUT_SHORT / Math.min(w, h));
  if (scale < MIN_GAIN) return null;
  const even = (v: number) => Math.max(2, Math.round(v) & ~1);
  return [even(w * scale), even(h * scale)];
}

/** Network runs per frame. */
export function tileCount(w: number, h: number): number {
  return Math.ceil(w / NEURAL_CORE) * Math.ceil(h / NEURAL_CORE);
}

/**
 * Rough time for the network over the whole video, in minutes (recent phone GPU … CPU fallback).
 * One 192×192 tile is about 87 GFLOP: roughly 0.1 s on a recent phone GPU and 1–1.5 s on its CPU
 * (0.5 s on 2 desktop cores). The save screen shows the real time left once it's running.
 */
export function neuralMinutes(frames: number, w: number, h: number): [number, number] {
  const tiles = frames * tileCount(w, h);
  return [Math.max(1, Math.round((tiles * 0.1) / 60)), Math.max(2, Math.round((tiles * 1.2) / 60))];
}

/**
 * The frame-timing maths of the native engine, mirrored in TypeScript for the export screen's
 * estimates and for tests. Keep in sync with MemcShaderProgram.scheduleInBetween (Kotlin).
 */

/**
 * Times (µs) of the made-up frames between source frames at [aUs] and [bUs].
 * They sit on a regular grid of 1/targetFps (scaled by playback speed), at least half a step
 * away from both real frames.
 */
export function inBetweenTimes(aUs: number, bUs: number, targetFps: number, speed = 1, max = 63): number[] {
  const gap = bUs - aUs;
  if (gap <= 0) return [];
  const step = (1_000_000 * Math.max(0.05, speed)) / Math.max(1, targetFps);
  if (step >= gap * 0.75) return [];
  const out: number[] = [];
  let k = Math.ceil((aUs + step * 0.5) / step);
  while (out.length < max) {
    const tau = Math.round(k * step);
    if (tau >= bUs - step * 0.5) break;
    if (tau > aUs) out.push(tau);
    k++;
  }
  return out;
}

/** Frames shown per second of real time when a [sourceFps] video plays at [speed], smoothed to [targetFps]. */
export function outputRate(sourceFps: number, targetFps: number, speed = 1): number {
  if (sourceFps <= 0) return 0;
  const gapUs = 1_000_000 / sourceFps;
  // Average over a few source frames so a non-multiple grid (25 → 60) comes out right.
  const n = 12;
  let made = 0;
  for (let i = 0; i < n; i++) made += inBetweenTimes(i * gapUs, (i + 1) * gapUs, targetFps, speed).length + 1;
  return (made / n) * sourceFps * speed;
}

export type ExportPlan = {
  /** Length of the saved video. */
  durationMs: number;
  /** Frames in the saved video. */
  frames: number;
  /** Share of those frames the engine makes up (0..1). */
  generatedShare: number;
  /** Rough size at ~0.12 bits per pixel per frame (H.264, phone encoder). */
  approxBytes: number;
};

/** What saving a [durationMs] clip at [fps], [slowMotion]× slower, produces. */
export function planExport(
  durationMs: number,
  sourceFps: number,
  fps: number,
  slowMotion: number,
  width: number,
  height: number,
): ExportPlan {
  const slow = Math.max(1, slowMotion);
  const outMs = durationMs * slow;
  const src = sourceFps > 0 ? sourceFps : 30;
  // Source frames are spread out by the slow-down; the engine fills to `fps`.
  const shown = outputRate(src / slow, fps);
  const frames = Math.round((outMs / 1000) * shown);
  const real = Math.round((durationMs / 1000) * src);
  const generatedShare = frames > 0 ? Math.max(0, Math.min(1, 1 - real / frames)) : 0;
  const pixels = Math.max(1, width) * Math.max(1, height);
  const approxBytes = (pixels * 0.12 * frames) / 8;
  return { durationMs: outMs, frames, generatedShare, approxBytes };
}

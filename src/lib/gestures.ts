/** Maths for the player's swipe gestures (pure; covered by tests). */

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Horizontal swipe → seek offset. A full-width swipe moves 90 s, or the whole video if shorter,
 * with finer control near the start of the swipe.
 */
export function seekOffsetForSwipe(dx: number, width: number, durationMs: number): number {
  if (width <= 0) return 0;
  const span = Math.min(90_000, Math.max(10_000, durationMs));
  const f = clamp(dx / width, -1, 1);
  return Math.round(Math.sign(f) * Math.pow(Math.abs(f), 1.4) * span);
}

/** Vertical swipe on the left/right half → new brightness/volume (0..1). Up = more. Full height = full range. */
export function levelForSwipe(start: number, dy: number, height: number): number {
  if (height <= 0) return start;
  return clamp(start - (dy / height) * 1.2, 0, 1);
}

/** Which side of the screen a touch at [x] is on, for double-tap seek and level swipes. */
export function sideOf(x: number, width: number): 'left' | 'center' | 'right' {
  if (x < width * 0.38) return 'left';
  if (x > width * 0.62) return 'right';
  return 'center';
}

/** Pinch scale → next resize mode: spreading fingers fills the screen, pinching fits the video. */
export function resizeForPinch(scale: number, current: 'fit' | 'fill' | 'zoom'): 'fit' | 'fill' | 'zoom' {
  if (scale > 1.12) return current === 'fit' ? 'zoom' : current;
  if (scale < 0.9) return 'fit';
  return current;
}

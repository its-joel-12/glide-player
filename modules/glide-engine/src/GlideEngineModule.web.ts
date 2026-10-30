/** Web version of the engine module: volume and screen refresh rate; saving copies needs the Android app. */
import type { DisplayInfo, ExportOptions, ExportResult } from './GlideEngine.types';

/** The native export engine; the web player itself always works. */
export const isEngineAvailable = false;

let hz = 60;
let measuring = false;
/** Measures the screen refresh rate from animation frames (once, in the background). */
function measure() {
  if (measuring || typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return;
  measuring = true;
  const deltas: number[] = [];
  let last = 0;
  const step = (now: number) => {
    if (last) deltas.push(now - last);
    last = now;
    if (deltas.length < 60) requestAnimationFrame(step);
    else hz = Math.round(1000 / [...deltas].sort((a, b) => a - b)[deltas.length >> 1]);
  };
  requestAnimationFrame(step);
}

export function getDisplayInfo(): DisplayInfo {
  measure();
  return { refreshRates: [hz], maxRefreshRate: hz, currentRefreshRate: hz };
}

let volume = 1;
const listeners = new Set<(v: number) => void>();

/** Player volume, 0..1 (browsers can't change the device volume). */
export function getVolume(): number {
  return volume;
}

export function setVolume(fraction: number): number {
  volume = Math.min(1, Math.max(0, fraction));
  listeners.forEach((l) => l(volume));
  return volume;
}

export function subscribeVolume(listener: (v: number) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function exportSmooth(_options: ExportOptions): Promise<ExportResult> {
  return Promise.reject(new Error('Saving smooth videos needs the Android app.'));
}

export function shareVideo(_uri: string, _title: string): Promise<void> {
  return Promise.reject(new Error('Sharing needs the Android app.'));
}

export function cancelExport(): Promise<void> {
  return Promise.resolve();
}

export function addExportProgressListener(_listener: (progress: number) => void): () => void {
  return () => {};
}

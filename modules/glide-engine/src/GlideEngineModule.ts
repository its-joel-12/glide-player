import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { DisplayInfo, ExportOptions, ExportResult } from './GlideEngine.types';

type Events = { onExportProgress: (e: { progress: number }) => void };

declare class GlideEngineNative extends NativeModule<Events> {
  getDisplayInfo(): DisplayInfo;
  getVolume(): number;
  setVolume(fraction: number): number;
  exportSmooth(options: ExportOptions): Promise<ExportResult>;
  cancelExport(): Promise<void>;
}

/** null on platforms without the native engine yet (iOS, web). */
const native = requireOptionalNativeModule<GlideEngineNative>('GlideEngine');

export const isEngineAvailable = native != null;

export function getDisplayInfo(): DisplayInfo {
  return native?.getDisplayInfo() ?? { refreshRates: [60], maxRefreshRate: 60, currentRefreshRate: 60 };
}

/** System media volume, 0..1. */
export function getVolume(): number {
  return native?.getVolume() ?? 1;
}

/** Sets the system media volume (0..1) and returns the value it actually got. */
export function setVolume(fraction: number): number {
  return native?.setVolume(fraction) ?? fraction;
}

export function exportSmooth(options: ExportOptions): Promise<ExportResult> {
  if (!native) return Promise.reject(new Error('Saving smooth videos needs the Android app.'));
  return native.exportSmooth(options);
}

export function cancelExport(): Promise<void> {
  return native?.cancelExport() ?? Promise.resolve();
}

/** Progress 0..100 while a video is being saved. Returns an unsubscribe function. */
export function addExportProgressListener(listener: (progress: number) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onExportProgress', (e) => listener(e.progress));
  return () => sub.remove();
}

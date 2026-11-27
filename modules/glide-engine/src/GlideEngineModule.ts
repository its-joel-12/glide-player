import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { DisplayInfo, ExportOptions, ExportResult } from './GlideEngine.types';

type Events = { onExportProgress: (e: { progress: number }) => void; onExportDamaged: (e: { positionMs: number }) => void };

declare class GlideEngineNative extends NativeModule<Events> {
  getDisplayInfo(): DisplayInfo;
  getVolume(): number;
  setVolume(fraction: number): number;
  exportSmooth(options: ExportOptions): Promise<ExportResult>;
  cancelExport(): Promise<void>;
  /** Missing in development builds made before damaged-file handling. */
  answerExportDamaged?(keepGoing: boolean): Promise<void>;
  shareVideo(uri: string, title: string): Promise<void>;
  /** Missing in development builds made before multi-select. */
  shareVideos?(uris: string[], title: string): Promise<void>;
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

/** Android share sheet for a gallery video (content:// URI). */
export function shareVideo(uri: string, title: string): Promise<void> {
  if (!native) return Promise.reject(new Error('Sharing needs the Android app.'));
  return native.shareVideo(uri, title);
}

/** One Android share sheet for several gallery videos. */
export function shareVideos(uris: string[], title: string): Promise<void> {
  if (!native) return Promise.reject(new Error('Sharing needs the Android app.'));
  if (uris.length === 1) return native.shareVideo(uris[0], title);
  if (!native.shareVideos) return Promise.reject(new Error('Sharing several videos at once needs the latest build of the app.'));
  return native.shareVideos(uris, title);
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

/**
 * A seekable copy found damaged data (e.g. a download that didn't finish) at this point of the
 * video. Copying waits until answerExportDamaged() is called. Returns an unsubscribe function.
 */
export function addExportDamagedListener(listener: (positionMs: number) => void): () => void {
  if (!native) return () => {};
  const sub = native.addListener('onExportDamaged', (e) => listener(e.positionMs));
  return () => sub.remove();
}

/** true = skip the damaged parts and go on; false = stop (the copy fails with code DAMAGED). */
export function answerExportDamaged(keepGoing: boolean): Promise<void> {
  return native?.answerExportDamaged?.(keepGoing) ?? Promise.resolve();
}

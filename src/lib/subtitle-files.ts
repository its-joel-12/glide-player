/** Subtitle files the user adds in the player, kept so they're still there next time. */
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Copies a picked file (in the cache, which the system may clear) to app storage and returns the
 * copy's URI, or the original URI if copying fails.
 */
export function keepSubtitleFile(uri: string, name: string): string {
  try {
    const dir = new Directory(Paths.document, 'subtitles');
    dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${Date.now()}-${name.replace(/[\\/:*?"<>|]/g, '_')}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** False for a file:// subtitle that's gone (a deleted copy or cleared cache); other URIs are kept. */
export function subtitleFileExists(uri: string): boolean {
  if (!uri.startsWith('file://')) return true;
  try {
    return new File(uri).exists;
  } catch {
    return true;
  }
}

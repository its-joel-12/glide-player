/**
 * Remembers the video open in the player while the app is in the background. Android may close
 * the app after a long time away; when it starts again, the library opens that video again
 * (paused, at the saved position). Leaving the player normally forgets it.
 */
import { Platform } from 'react-native';

import { openVideoFrom, type OpenVideo } from './open-video-rules';
import { loadJSON, saveJSON, StorageKeys } from './storage';

export type { OpenVideo } from './open-video-rules';

export function rememberOpenVideo(v: OpenVideo) {
  if (Platform.OS === 'web') return; // web file addresses don't survive a reload
  void saveJSON(StorageKeys.openVideo, v);
}

export function forgetOpenVideo() {
  if (Platform.OS === 'web') return;
  void saveJSON(StorageKeys.openVideo, null);
}

let taken = false;
/**
 * The video that was open when the app was last closed, once per app start (then forgotten, so a
 * video that crashes the app isn't reopened forever: the player remembers it again once it plays).
 */
export async function takeOpenVideo(): Promise<OpenVideo | null> {
  if (taken || Platform.OS === 'web') return null;
  taken = true;
  const v = openVideoFrom(await loadJSON<unknown>(StorageKeys.openVideo, null));
  if (v) await saveJSON(StorageKeys.openVideo, null);
  return v;
}

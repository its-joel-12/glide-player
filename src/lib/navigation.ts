import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';

import { titleFromName } from './format';

export type VideoRef = { id: string; uri: string; title: string; width?: number; height?: number; durationMs?: number };

const str = (n: number | undefined) => (n ? String(Math.round(n)) : '');

export function openPlayer(v: VideoRef, opts: { fromStart?: boolean } = {}) {
  router.push({
    pathname: '/player',
    params: { id: v.id, uri: v.uri, title: v.title, w: str(v.width), h: str(v.height), fromStart: opts.fromStart ? '1' : '' },
  });
}

export function openExport(v: VideoRef) {
  router.push({
    pathname: '/export',
    params: { id: v.id, uri: v.uri, title: v.title, w: str(v.width), h: str(v.height), d: str(v.durationMs) },
  });
}

/** Lets the user pick any video file (Downloads, SD card, other apps). */
export async function pickVideoFile(): Promise<VideoRef | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: 'video/*', copyToCacheDirectory: false, multiple: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  return { id: a.uri, uri: a.uri, title: titleFromName(a.name) };
}

/** Lets the user pick a subtitle file to add to the playing video. */
export async function pickSubtitleFile(): Promise<{ uri: string; name: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({
    type: ['application/x-subrip', 'text/vtt', 'text/x-ssa', 'text/plain', 'application/octet-stream', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (r.canceled || !r.assets?.length) return null;
  return { uri: r.assets[0].uri, name: r.assets[0].name };
}

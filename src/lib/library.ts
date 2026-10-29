/** Videos on the phone, read through the media library (MediaStore on Android). */
import {
  Album,
  AssetField,
  getPermissionsAsync,
  MediaType,
  presentPermissionsPicker,
  Query,
  requestPermissionsAsync,
  type AssetMetadata,
  type PermissionResponse,
} from 'expo-media-library';

export type VideoItem = {
  /** content:// URI; also the key for resume positions. */
  id: string;
  uri: string;
  title: string;
  durationMs: number;
  width: number;
  height: number;
  modifiedAt: number;
};

export type Folder = { id: string; title: string; count: number; cover: VideoItem | null };

export type Access = 'unknown' | 'granted' | 'limited' | 'denied' | 'blocked';

const VIDEO = ['video'] as const;

function toAccess(r: PermissionResponse): Access {
  if (r.granted) return r.accessPrivileges === 'limited' ? 'limited' : 'granted';
  return r.canAskAgain ? 'denied' : 'blocked';
}

export async function checkAccess(): Promise<Access> {
  try {
    return toAccess(await getPermissionsAsync(false, [...VIDEO]));
  } catch {
    return 'denied';
  }
}

export async function requestAccess(): Promise<Access> {
  try {
    return toAccess(await requestPermissionsAsync(false, [...VIDEO]));
  } catch {
    return 'denied';
  }
}

/** Android 14+: lets the user pick more videos when they shared only some. */
export async function chooseMoreVideos(): Promise<void> {
  try {
    await presentPermissionsPicker(['video']);
  } catch {
    // not available on this Android version
  }
}

function toItem(m: AssetMetadata): VideoItem {
  const title = m.filename ? m.filename.replace(/\.[^.]+$/, '') : 'Video';
  return {
    id: m.id,
    uri: m.id,
    title,
    durationMs: m.duration ?? 0,
    width: m.width ?? 0,
    height: m.height ?? 0,
    modifiedAt: m.modificationTime ?? m.creationTime ?? 0,
  };
}

/** One page of videos, newest first. */
export async function fetchVideos(options: { album?: Album; offset?: number; limit?: number } = {}): Promise<VideoItem[]> {
  let q = new Query().eq(AssetField.MEDIA_TYPE, MediaType.VIDEO);
  if (options.album) q = q.album(options.album);
  q = q.orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false }).limit(options.limit ?? 60).offset(options.offset ?? 0);
  const rows = await q.exeForMetadata();
  return rows.map(toItem);
}

/** Folders that contain videos, with how many and the newest one as a cover. Biggest first. */
export async function fetchFolders(): Promise<Folder[]> {
  const albums = await Album.getAll();
  const folders: Folder[] = [];
  const queue = [...albums];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      try {
        const rows = await new Query()
          .eq(AssetField.MEDIA_TYPE, MediaType.VIDEO)
          .album(a)
          .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
          .limit(2000)
          .exeForMetadata();
        if (!rows.length) continue;
        folders.push({ id: a.id, title: await a.getTitle(), count: rows.length, cover: toItem(rows[0]) });
      } catch {
        // skip folders we can't read
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return folders.sort((x, y) => y.count - x.count || x.title.localeCompare(y.title));
}

export function albumById(id: string): Album {
  return new Album(id);
}

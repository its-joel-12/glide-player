/**
 * Web: browsers can't list the videos on a device, so there is no library. The web home screen
 * opens files instead (src/app/index.web.tsx). These stubs keep shared screens building.
 */
export type VideoItem = {
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

export async function checkAccess(): Promise<Access> {
  return 'denied';
}

export async function requestAccess(): Promise<Access> {
  return 'denied';
}

export async function chooseMoreVideos(): Promise<void> {}

export async function fetchVideos(_options: { album?: unknown; offset?: number; limit?: number } = {}): Promise<VideoItem[]> {
  return [];
}

export async function fetchAllVideos(_album?: unknown): Promise<VideoItem[]> {
  return [];
}

export async function deleteVideo(_item: { id: string }): Promise<void> {
  throw new Error('Deleting needs the Android app.');
}

export async function fetchFolders(): Promise<Folder[]> {
  return [];
}

export function albumById(id: string): { id: string } {
  return { id };
}

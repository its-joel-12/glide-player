/** Web: no thumbnails for local files (the library is Android only). */
export function useThumbnail(_id: string, _uri: string, _durationMs: number): string | null {
  return null;
}

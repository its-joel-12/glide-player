/** Pure helper (covered by tests). */

/**
 * The same gallery video can show up as content://media/external/video/media/42,
 * content://media/external_primary/video/media/42 or just its id: key by the id.
 */
export function sidecarKey(uri: string): string {
  const m = /^(?:content:\/\/media\/.*\/)?(\d+)$/.exec(uri);
  return m ? `media:${m[1]}` : uri;
}

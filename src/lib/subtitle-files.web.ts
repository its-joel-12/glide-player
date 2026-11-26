/** Web: picked files are blob: URLs that only last for the page, so nothing is kept. */
export function keepSubtitleFile(uri: string): string {
  return uri;
}

export function subtitleFileExists(): boolean {
  return true;
}

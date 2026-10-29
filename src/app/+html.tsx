import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

/**
 * Web only: the HTML page around the app. Adds what's needed to install it on a phone's home
 * screen (iPhone: Share → Add to Home Screen) and to run full-screen.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>Glide</title>
        <meta name="description" content="Video player with motion smoothing (MEMC): plays your video files at your screen's full refresh rate." />

        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Glide" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F2F4F6" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0E1114" />

        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: pageBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// Matches the theme so there's no white flash while loading, in light and dark mode.
const pageBackground = `
body { background-color: #F2F4F6; }
@media (prefers-color-scheme: dark) { body { background-color: #0E1114; } }
`;

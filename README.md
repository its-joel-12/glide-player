# Glide

A video player for Android, built with React Native (Expo), that smooths motion like the
**MEMC** setting on phones and TVs, and saves smooth or slow-motion copies like an
**optical-flow retime** in a video editor.

Your phone's own MEMC (e.g. on the iQOO Neo 9 Pro) runs in the display chip and works inside
Netflix, Prime Video and YouTube. Those apps protect their streams, so no other app can process
them; Glide plays **video files on your phone** (gallery, Downloads, SD card, any file you open).

## Features

- **Smooth playback (MEMC):** for every new frame, the GPU estimates how each 8×8 block moved and
  draws in-between frames along those paths, so 24/30 fps video fills every refresh of a
  60/90/120/144 Hz screen. Modes: *Off*, *Blend* (cross-fade) and *MEMC*. The sound stays in sync.
- **Split compare** (original on the left, smoothed on the right, draggable line) and a
  **motion-vector view** (colour = direction, strength = speed). Full-screen by default.
- **Smooth slow motion:** at 0.25–0.75× speed the engine fills the missing frames.
- **Save a smooth or slow-motion copy:** optical-flow retime to 30/60/120 fps, or 2×/4×/8× slower,
  with a slower, more detailed analysis than playback (half- and quarter-pixel). Saved to
  *Movies/Glide*; the original isn't changed.
- **Library:** all videos newest first, folders, thumbnails, durations, *Continue watching* with
  resume positions; open any other file from the folder button.
- **Player essentials:** swipe sideways to seek, up/down on the left for brightness and on the right
  for volume, double-tap to skip, pinch to fill the screen; subtitles (built-in tracks or .srt/.vtt/.ass
  files), audio track choice, speed, picture-in-picture, background sound with lock-screen controls,
  lock controls, rotate.

## How the smoothing works

`modules/glide-engine` is a local Expo module (Kotlin). It plugs one GPU effect
(`MemcShaderProgram`) into AndroidX Media3, used by both ExoPlayer (playback) and Transformer
(saving):

1. Each decoded frame is copied and turned into a 4–5 level luma pyramid.
2. Hierarchical block matching, coarse to fine, in both directions (A→B and B→A), with predictor
   candidates from the coarser level, its neighbours and the previous frame, then a 3×3 vector median.
3. In-between frames are placed on a regular grid at your screen's refresh rate and drawn by sampling
   both frames along the motion paths. Each pixel weighs three explanations (forward, backward, no
   motion) by how well they agree, and falls back to the nearer real frame where none fits
   (occlusions, scene cuts).
4. The player asks Android for the highest refresh rate and ExoPlayer shows each frame at its own
   timestamp, so audio stays in sync.

In a test against true in-between frames (a 24 fps panning scene), MEMC was about 10 dB closer to
the real frame than plain frame repeat or blending; the export analysis adds about 1.5 dB more.

## Project layout

| Path | What |
|---|---|
| `src/app/` | Screens (Expo Router): library, folder, player, smooth copy, settings |
| `src/components/` | UI pieces; `player/` has controls, gestures, seek bar, sheets |
| `src/lib/` | Library access, thumbnails, resume positions, settings, frame-timing maths |
| `modules/glide-engine/` | The native engine (Kotlin) and its TypeScript API |
| `plugins/with-glide-activity.js` | Manifest flags for picture-in-picture |
| `tests/app.test.js` | Logic tests (`npm test`) |

## Getting started (development)

The engine is native code, so Expo Go can't run it. Build the development app once:

```bash
npm install
npx eas-cli@latest init        # one time: links the project to your Expo account (adds projectId)
npm run build:dev              # EAS cloud build of the development app; install the APK on the phone
```

Then, with the phone on USB (USB debugging on):

```bash
npm run usb
```

The phone opens the development build and reloads as you edit JavaScript. After changing Kotlin
(anything in `modules/glide-engine/android`), build the development app again.

## Scripts

| Command | What it does |
|---|---|
| `npm run usb` | Forward port 8081 over USB (adb reverse) and start Expo |
| `npm start` | Start Expo (Wi-Fi / QR code) |
| `npm test` | Logic tests (formatting, frame timing, resume, gestures, settings) |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run build:dev` | Development app (APK) on EAS |
| `npm run build:apk` | Shareable APK on EAS |
| `npm run build:apk:local` | APK on this laptop into `builds/` (add `-- --install` to put it on the USB phone) |

Local builds need Android Studio's SDK and Java 17+. On Windows, React Native's C++ build needs a
short project path or Windows long paths turned on; the script explains both.

## Tips

- If smoothing looks capped at 60 fps, set the phone's screen refresh rate to *High* (some phones
  lower it for video apps). The player's frame-rate readout (Settings → *Show frame rate*) shows
  source fps → screen fps and made-up frames per second.
- *Analysis → Detailed* follows small, fast motion better; *Fast* saves battery on 4K.
- Fast cuts, rain, and thin repeating patterns are hard for any MEMC.

## Roadmap

- [x] Real-time MEMC playback, split compare, motion vectors
- [x] Optical-flow export (smooth / slow motion)
- [x] Library, resume, gestures, subtitles, PiP, background audio
- [ ] Per-pixel (dense) flow refinement for saved copies
- [ ] Neural interpolation (RIFE-style, like DaVinci Resolve's Speed Warp) for saved copies
- [ ] Super-resolution (sharper upscaling of low-resolution videos)
- [ ] iOS engine (AVFoundation + Metal)

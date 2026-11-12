# Glide

A video player for Android and the web, built with React Native (Expo), that smooths motion like the
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
- **Live upscaling:** videos smaller than the screen (360p, 480p, pixelated clips) are resampled to
  the size they're shown at with an edge-directed filter (the idea behind AMD FSR 1) and then
  sharpened, on the GPU, for every frame, together with smoothing. Turn it on in the player's
  *Picture* sheet or in Settings (*U* on the web); split compare shows original vs. upscaled.
- **AI-upscaled copy:** *Save a copy → Sharper* runs every frame through a small super-resolution
  network (Real-ESRGAN general x4v3, 2.5 MB, TensorFlow Lite on the GPU) and saves a 2× or 4× bigger
  copy (up to 4K) to *Movies/Glide*. It rebuilds edges, text and texture and cleans up compression
  blocks; it's slow (roughly 0.1 s per 168×168 tile on a recent phone GPU, about 10× that on the CPU),
  so it's for videos up to 720p. It can be combined with a smooth or slow-motion copy.
- **Save a smooth or slow-motion copy:** optical-flow retime to 30/60/120 fps, or 2×/4×/8× slower,
  with a slower, more detailed analysis than playback (half- and quarter-pixel). Saved to
  *Movies/Glide*; the original isn't changed.
- **Seekable copy:** some files (often MKVs and recordings) have no seek index, so no player can jump
  around in them or resume them. The player says so and shows a *Make seekable* button that writes an
  MP4 copy to *Movies/Glide*. The picture is copied without re-encoding, every audio track is kept
  (converted to AAC when MP4 can't hold it and the phone can decode it), and text subtitles (SRT/ASS/
  WebVTT) are saved alongside and load automatically when the copy plays in Glide.
- **Library:** all videos as big thumbnails or a compact list, sorted by date, name or length;
  search by name (every word, any order, so "matrix 1080" finds `The.Matrix.1999.1080p`);
  folders, thumbnails, durations, a tick on videos you've watched to the end, *Continue watching* with
  resume positions (⋮ or long-press a card to remove it, or mark it as watched); share or delete a video from its menu (long-press or ⋮); open any other file from
  the folder button.
- **Player essentials:** swipe sideways to seek, up/down on the left for brightness and on the right
  for volume, double-tap to skip, pinch to fill the screen; subtitles (built-in tracks or .srt/.vtt/.ass
  files), audio track choice, speed, picture-in-picture, background sound with lock-screen controls,
  lock controls, rotate. Press and hold the video to play at 2× while your finger is down (slide sideways
  for 1.5× or 3×; the speed and an off switch are in Settings). The brightness and volume swipes can each be turned off in Settings.
- **Audio and subtitle delay (like VLC):** in *Audio & subtitles*, nudge the sound or the subtitles
  earlier or later in 50 ms steps (or 0.5 s / 1 s jumps). Default delays for every video are set in
  Settings → *Audio & subtitle sync* (or with *Use these delays for all videos* in the player); changes
  in the player apply to the current video only, tapping the value goes back to the default, and a badge next to the time shows them while the controls are up.
- **Subtitle style:** size, font (sans, serif, mono, narrow, casual), bold, text colour, background
  (none, box or band, with colour and opacity), outline/shadow and its colour, height on screen, and
  whether to keep the styles inside .ass files. Set it in Settings or from the player, with a live preview.
- **Frame-rate readout:** a toggle (Settings, the smoothing panel, or the I key on the web) shows the
  video's frame rate, the frames per second actually reaching the screen, made-up frames, dropped
  frames and the screen's refresh rate.

## Web version

The same app runs in a browser (Chrome, Edge, Firefox, Safari, including on iPhone and Android).
The web player uses the same motion engine, ported to WebGL 2 with the same shaders:

- Open a video file (button or drag and drop; the file stays on the device) or watch the built-in
  24 fps demo clip.
- Off / Blend / MEMC, live upscaling, split compare, motion vectors, smooth slow motion, subtitle files
  (.srt, .vtt, .ass), speed, full screen, swipe gestures on phones.
- Keys: Space play/pause · ←/→ seek · ↑/↓ volume · M smoothing mode · U upscaling · C split compare ·
  V motion vectors · F full screen · I frame rates · J/K audio delay −/+ 50 ms ·
  G/H subtitle delay −/+ 50 ms.
- In the browser the sound can be moved at most 0.5 s earlier (the picture is held back to do it).
- Not on the web: the phone's video library, MKV/HEVC files the browser can't decode,
  picture-in-picture, and saving smooth copies (Android app only).

Try it locally with `npm run web`; build it with `npm run build:web` (output in `dist/`).

### Deploy to Netlify

`netlify.toml` is set up like the Expense Tracker: Netlify runs `npx expo export --platform web`
and publishes `dist`. In Netlify: *Add new site → Import an existing project → GitHub →
glide-player*. Every push to `main` then publishes a new version. On an iPhone, open the site in
Safari and choose *Share → Add to Home Screen* to get a full-screen app icon.

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
| `modules/glide-engine/` | The engine: Android (Kotlin, `android/`), web (WebGL 2, `src/web/`), and the shared TypeScript API |
| `modules/glide-engine/android/.../upscale/` | Live upscaling effect, and the AI upscaler for saved copies (model in `src/main/assets/`) |
| `scripts/sr-model/` | How the AI upscaling model was converted to TensorFlow Lite (and a check against the original) |
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
| `npm run web` | Run the web version on this laptop |
| `npm run build:web` | Build the web version into `dist/` (what Netlify runs) |

Local builds need Android Studio's SDK and Java 17+. On Windows, React Native's C++ build needs a
short project path or Windows long paths turned on; the script explains both.

## Builds on GitHub

Every push to `main` builds the APK on GitHub Actions (`.github/workflows/android-apk.yml`): it runs
the typecheck, lint and tests, builds with `npm run build:apk:local`, signs with the same key as your
EAS builds, and publishes it on the repo's **Releases** page (the last 10 are kept) so you can download
it straight on the phone. You can also start it by hand: **Actions → Android APK → Run workflow**.

One-time setup:

1. Download the signing key: `npx eas-cli@latest credentials -p android` → *preview* profile →
   (if there's no keystore yet) *Set up a new keystore* → *credentials.json: Upload/Download* →
   *Download credentials from EAS to credentials.json*. This creates `credentials.json` and
   `credentials/android/keystore.jks` (both git-ignored; keep a backup, the key can't be recreated).
2. Put it into the repo's secrets: `npm run ci:secrets` (uses the GitHub CLI, `gh auth login` first), or
   `npm run ci:secrets -- --print` and add the four values under **Settings → Secrets and variables →
   Actions**.
3. Push to `main`.

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
- [x] Web version (WebGL 2), deployable to Netlify
- [ ] Per-pixel (dense) flow refinement for saved copies
- [ ] Neural interpolation (RIFE-style, like DaVinci Resolve's Speed Warp) for saved copies
- [x] Super-resolution: live edge-directed upscaling + sharpening, and AI (Real-ESRGAN) upscaled copies
- [ ] AI upscaling during playback (needs a much smaller network, or an NPU path)
- [ ] iOS engine (AVFoundation + Metal)

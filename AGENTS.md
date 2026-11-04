This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## This project: Glide (video player with motion smoothing)

- **Android and web.** The smoothing engine is a local Expo module in `modules/glide-engine` (Kotlin, autolinked from `./modules`). The web version is `GlidePlayer.web.tsx` + `src/web/` (WebGL 2 port with the same shaders and props). There is no iOS engine yet: `GlidePlayer` shows a placeholder there. An iOS version needs the same effect written for AVFoundation + Metal behind the same TypeScript API (`modules/glide-engine/src/GlideEngine.types.ts`).
- **Web specifics:** platform files (`*.web.ts(x)`) replace Android-only parts: `src/app/index.web.tsx` (open a file / demo instead of the library), `src/lib/library.web.ts` and `thumbnails.web.ts` (stubs), `src/hooks/use-color-scheme.web.ts` (pages are pre-rendered in light mode, so the theme switches after hydration). Don't touch `window`/`document` during render (static rendering runs in Node).
- **Shaders live in two places:** `memc/Shaders.kt` (Android) and `src/web/shaders.ts` (web). They must stay identical; `npm test` checks it.
- **Engine layout** (`modules/glide-engine/android/src/main/java/expo/modules/glide/`):
  - `memc/` — the GPU frame-interpolation effect. `MemcShaderProgram` is a Media3 `GlShaderProgram` used both by ExoPlayer (`setVideoEffects`, live playback) and by Transformer (saved copies). `MotionEngine` does the luma pyramid, block-matching motion estimation and interpolation; shaders are in `Shaders.kt` (GLSL ES 3.00).
  - `GlidePlayerView` — the native view (ExoPlayer surface, subtitles, tracks, picture-in-picture, refresh rate). `PlayerHolder` — the one shared player + media session. `SmoothExporter` — Transformer export to Movies/Glide.
  - `upscale/` — `LiveUpscaler.kt`: `LiveUpscaleEffect`, a `GlShaderProgram` chained after `MemcEffect` in playback that resamples to the video surface's size (`UPSCALE`, edge-directed like FSR 1 EASU) and sharpens (`SHARPEN`, like RCAS); `UpscaleSize` limits are mirrored in `src/web/engine.ts` (`upscaleSize`, tested). `NeuralUpscaler.kt` + `NeuralUpscaleEffect.kt`: AI upscaling for saved copies only (TensorFlow Lite 2.17 + GPU delegate, Real-ESRGAN general x4v3 as `assets/glide-sr-x4.tflite`, 192×192 tiles with 12 px margins, run on its own thread); `NeuralPlan` is mirrored in `src/lib/upscale-plan.ts` (tested). Rebuild the model with `scripts/sr-model/`.
  - `plugins/with-glide-activity.js` — manifest flags for picture-in-picture.
- **Keep TS and Kotlin in step:** frame timing lives in `MemcShaderProgram.scheduleInBetween` (Kotlin) and is mirrored in `src/lib/cadence.ts` (TypeScript, tested). Change both together.
- **Audio/subtitle delay:** Media3 has no offset API, so `Timing.kt` wraps the video and text renderers (`ShiftedRenderer`, via `GlideRenderersFactory`) and asks them for a shifted position; audio drives the clock, so audio delay moves the picture. The web version holds the picture back and delays the sound with a WebAudio `DelayNode` (`src/web/core.ts`).
- **Subtitle style** is one `SubtitleStyle` object (types file) applied with `CaptionStyleCompat` on Android and `src/web/subtitle-style.ts` on the web.
- Media3 classes used here are `@UnstableApi`; annotate new Kotlin classes with `@OptIn(UnstableApi::class)`.
- Native changes need a new development build (`npm run build:dev`, or `npm run build:apk:local`); JS changes reload live with `npm run usb`.
- Before declaring work done: `npm run typecheck`, `npm run lint`, `npm test`.

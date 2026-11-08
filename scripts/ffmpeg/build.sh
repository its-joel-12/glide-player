#!/usr/bin/env bash
# Builds FFmpeg's audio decoders for the player (Dolby Digital AC-3 / E-AC-3, TrueHD, DTS, MP3, ALAC),
# for the phone audio a phone often can't decode itself. Output: static libraries in
# modules/glide-engine/android/src/main/jni/ffmpeg/android-libs/<abi>/, which Gradle then links into
# libffmpegJNI.so (modules/glide-engine/android/build.gradle turns the native build on when they exist).
#
# Runs on Linux or macOS (GitHub Actions does it for every APK build, see .github/workflows/android-apk.yml).
# On Windows run it in WSL with a Linux NDK. Without these libraries the app still builds and plays,
# but files with only AC-3/DTS/TrueHD sound play silently on phones without a hardware decoder.
#
#   scripts/ffmpeg/build.sh [path to NDK]       (default: $ANDROID_NDK_HOME, or $ANDROID_HOME/ndk/<React Native's version>)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MODULE_MAIN="$ROOT/modules/glide-engine/android/src/main"
# FFmpeg 6.0 is the version Media3's FFmpeg decoder is tested with (androidx/media libraries/decoder_ffmpeg/README.md).
FFMPEG_BRANCH="release/6.0"
# Media3's decoder is built for minSdk; React Native 0.86's minSdk is 24.
MIN_SDK=24
DECODERS=(ac3 eac3 truehd dca mp3 alac)

NDK="${1:-${ANDROID_NDK_HOME:-}}"
if [[ -z "$NDK" ]]; then
  NDK_VERSION="$(sed -n 's/^ndkVersion = "\(.*\)"/\1/p' "$ROOT/node_modules/react-native/gradle/libs.versions.toml" 2>/dev/null || true)"
  NDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}/ndk/$NDK_VERSION"
fi
[[ -d "$NDK" ]] || { echo "Android NDK not found (tried '$NDK'). Pass its path: scripts/ffmpeg/build.sh <ndk>"; exit 1; }
case "$(uname -s)" in
  Linux) HOST=linux-x86_64 ;;
  Darwin) HOST=darwin-x86_64 ;;
  *) echo "Run this on Linux or macOS (on Windows: WSL)."; exit 1 ;;
esac

FFMPEG="$MODULE_MAIN/jni/ffmpeg"
if [[ ! -d "$FFMPEG/.git" && ! -f "$FFMPEG/configure" ]]; then
  git clone --depth 1 --branch "$FFMPEG_BRANCH" https://github.com/FFmpeg/FFmpeg.git "$FFMPEG"
fi

echo "NDK: $NDK"
echo "Decoders: ${DECODERS[*]}"
bash "$ROOT/scripts/ffmpeg/build_ffmpeg.sh" "$MODULE_MAIN" "$NDK" "$HOST" "$MIN_SDK" "${DECODERS[@]}"
ls -la "$FFMPEG/android-libs"/*/

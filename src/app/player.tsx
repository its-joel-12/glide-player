import * as Brightness from 'expo-brightness';
import { NavigationBar } from 'expo-navigation-bar';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import {
  getDisplayInfo,
  getVolume,
  GlidePlayer,
  setVolume,
  type GlidePlayerRef,
  type LoadEvent,
  type ResizeMode,
  type StatsEvent,
  type SubtitleSource,
  type TracksEvent,
  type VideoSource,
} from 'glide-engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { PlayerControls } from '@/components/player/controls';
import { GestureLayer } from '@/components/player/gesture-layer';
import { HudPill, type Hud } from '@/components/player/hud';
import { AUDIO_DELAY_RANGE, SmoothingSheet, SpeedSheet, SUBTITLE_DELAY_RANGE, SubtitleStyleSheet, TracksSheet } from '@/components/player/sheets';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/theme';
import { formatFps, formatOffset, formatTime } from '@/lib/format';
import { clamp } from '@/lib/gestures';
import { pickSubtitleFile } from '@/lib/navigation';
import { setPreference, usePreferences } from '@/lib/preferences';
import { clearResume, getResume, saveResume, startPosition } from '@/lib/resume';
import { DELAY_STEP_MS, formatDelay, type SmoothingMode } from '@/lib/settings-schema';

type SheetName = 'smoothing' | 'tracks' | 'subtitleStyle' | 'speed' | null;
const isWeb = Platform.OS === 'web';
/** The browser can only hold the picture back so far, so sound can't come more than 0.5 s early there. */
const MIN_AUDIO_DELAY_MS = isWeb ? -500 : AUDIO_DELAY_RANGE.min;

/** Back to the previous screen, or home when the player was opened directly (web refresh / link). */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

function toggleFullscreen() {
  if (typeof document === 'undefined') return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen?.().catch(() => {});
}
const MODES: SmoothingMode[] = ['off', 'blend', 'memc'];
const RESIZE: ResizeMode[] = ['fit', 'zoom', 'fill'];
const RESIZE_LABEL: Record<ResizeMode, string> = { fit: 'Fit', zoom: 'Fill screen (crop)', fill: 'Stretch' };

export default function PlayerScreen() {
  const params = useLocalSearchParams<{ id: string; uri: string; title?: string; w?: string; h?: string; fromStart?: string }>();
  const prefs = usePreferences();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const ref = useRef<GlidePlayerRef>(null);

  const id = params.id || params.uri;
  const title = params.title || 'Video';
  const [subtitles, setSubtitles] = useState<SubtitleSource[]>([]);
  const startAt = useMemo(() => (prefs.resume && !params.fromStart ? startPosition(getResume(id)) : 0), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const source = useMemo<VideoSource>(() => ({ uri: params.uri, title, startPositionMs: startAt, subtitles }), [params.uri, title, startAt, subtitles]);

  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [rate, setRate] = useState(1);
  const [compare, setCompare] = useState(false);
  const [split, setSplit] = useState(0.5);
  const [vectors, setVectors] = useState(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>('fit');
  const [controls, setControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [pip, setPip] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [pos, setPos] = useState({ positionMs: startAt, durationMs: 0, bufferedMs: 0 });
  const [scrubMs, setScrubMs] = useState<number | null>(null);
  const [tracks, setTracks] = useState<TracksEvent>({ audio: [], text: [] });
  const [info, setInfo] = useState<LoadEvent | null>(null);
  const [stats, setStats] = useState<StatsEvent | null>(null);
  // Audio/subtitle sync for this video only (like VLC), so a fix for one file doesn't break the next.
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [landscape, setLandscape] = useState<boolean | null>(() => {
    const w = Number(params.w);
    const h = Number(params.h);
    return prefs.autoRotate && w > 0 && h > 0 ? w >= h : null;
  });
  const display = useMemo(() => getDisplayInfo(), []);

  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef(0);
  const brightness = useRef<number | null>(null);
  const volume = useRef<number>(getVolume());
  const posRef = useRef(pos);
  useEffect(() => {
    posRef.current = pos;
  }, [pos]);

  const smoothingAvailable = info?.smoothing ?? true;

  // ---- feedback helpers
  const flashHud = useCallback((h: Hud | null, ms = 700) => {
    setHud(h);
    if (hudTimer.current) clearTimeout(hudTimer.current);
    if (h) hudTimer.current = setTimeout(() => setHud(null), ms);
  }, []);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // ---- auto-hide controls while playing (they stay while paused, ended or a panel is open)
  const [pokes, setPokes] = useState(0);
  const pinned = paused || ended || sheet !== null;
  const showControls = controls || pinned;
  const poke = useCallback(() => {
    setControls(true);
    setPokes((n) => n + 1);
  }, []);
  useEffect(() => {
    if (pinned || !controls) return;
    const t = setTimeout(() => setControls(false), 3500);
    return () => clearTimeout(t);
  }, [pinned, controls, pokes]);

  // ---- orientation, brightness restore, resume on exit
  useEffect(() => {
    return () => {
      if (!isWeb) {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
        void Brightness.restoreSystemBrightnessAsync().catch(() => {});
      }
      const p = posRef.current;
      if (p.durationMs > 0) saveResume(id, { positionMs: p.positionMs, durationMs: p.durationMs, title, uri: params.uri });
      [hudTimer, toastTimer].forEach((t) => t.current && clearTimeout(t.current));
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyOrientation = useCallback((wide: boolean) => {
    if (isWeb) return;
    setLandscape(wide);
    void ScreenOrientation.lockAsync(wide ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []);

  useEffect(() => {
    // Before the video reports its size, use the size from the library (if any).
    if (!isWeb && landscape !== null)
      void ScreenOrientation.lockAsync(landscape ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- native events
  const onLoad = (e: { nativeEvent: LoadEvent }) => {
    const ev = e.nativeEvent;
    setInfo(ev);
    setBuffering(false);
    if (prefs.autoRotate && ev.width > 0 && ev.height > 0 && landscape === null) applyOrientation(ev.width >= ev.height);
    if (startAt > 0) showToast(`Continuing from ${formatTime(startAt)}`);
  };
  const onProgress = (e: { nativeEvent: { positionMs: number; durationMs: number; bufferedMs: number } }) => {
    const ev = e.nativeEvent;
    setPos(ev);
    if (Date.now() - lastSaved.current > 5000 && ev.durationMs > 0) {
      lastSaved.current = Date.now();
      saveResume(id, { positionMs: ev.positionMs, durationMs: ev.durationMs, title, uri: params.uri });
    }
  };

  // ---- actions
  const seekTo = (ms: number) => {
    const target = clamp(ms, 0, Math.max(0, pos.durationMs - 500));
    setPos((p) => ({ ...p, positionMs: target }));
    setEnded(false);
    void ref.current?.seekTo(target);
  };
  const seekBy = (delta: number) => {
    seekTo(pos.positionMs + delta);
    flashHud({ kind: 'seek', label: formatOffset(delta), detail: formatTime(clamp(pos.positionMs + delta, 0, pos.durationMs)) });
  };
  const playPause = () => {
    if (ended) {
      setEnded(false);
      setPaused(false);
      void ref.current?.seekTo(0);
      return;
    }
    setPaused((p) => !p);
  };
  const setMode = (m: SmoothingMode) => {
    setPreference('mode', m);
    flashHud({ kind: 'text', label: m === 'memc' ? 'MEMC on' : m === 'blend' ? 'Blend' : 'Smoothing off' }, 900);
  };
  const cycleMode = () => setMode(MODES[(MODES.indexOf(prefs.mode) + 1) % MODES.length]);
  const cycleResize = () => {
    const next = RESIZE[(RESIZE.indexOf(resizeMode) + 1) % RESIZE.length];
    setResizeMode(next);
    flashHud({ kind: 'text', label: RESIZE_LABEL[next] }, 900);
  };
  const enterPip = async () => {
    const ok = await ref.current?.enterPip();
    if (!ok) showToast('Picture-in-picture isn’t available on this phone.');
  };
  const changeAudioDelay = (ms: number) => {
    const v = clamp(Math.round(ms), MIN_AUDIO_DELAY_MS, AUDIO_DELAY_RANGE.max);
    setAudioDelayMs(v);
    flashHud({ kind: 'text', label: `Audio delay ${formatDelay(v)}` }, 1000);
  };
  const changeSubtitleDelay = (ms: number) => {
    const v = clamp(Math.round(ms), SUBTITLE_DELAY_RANGE.min, SUBTITLE_DELAY_RANGE.max);
    setSubtitleDelayMs(v);
    flashHud({ kind: 'text', label: `Subtitle delay ${formatDelay(v)}` }, 1000);
  };
  const toggleStats = () => {
    setPreference('showStats', !prefs.showStats);
    flashHud({ kind: 'text', label: prefs.showStats ? 'Frame rates hidden' : 'Frame rates shown' }, 800);
  };
  const loadSubtitles = async () => {
    setSheet(null);
    const f = await pickSubtitleFile();
    if (!f) return;
    setSubtitles((s) => [...s, { uri: f.uri, label: f.name }]);
    showToast(`Added subtitles: ${f.name}`);
  };

  // ---- web: keyboard shortcuts, and moving the mouse shows the controls
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === ' ') playPause();
      else if (k === 'arrowleft') seekBy(-prefs.seekStep * 1000);
      else if (k === 'arrowright') seekBy(prefs.seekStep * 1000);
      // VLC-style sync keys: J/K audio delay, G/H subtitle delay, I frame-rate readout.
      else if (k === 'j' || k === 'k') changeAudioDelay(audioDelayMs + (k === 'k' ? DELAY_STEP_MS : -DELAY_STEP_MS));
      else if (k === 'g' || k === 'h') changeSubtitleDelay(subtitleDelayMs + (k === 'h' ? DELAY_STEP_MS : -DELAY_STEP_MS));
      else if (k === 'i') toggleStats();
      else if (k === 'arrowup' || k === 'arrowdown') {
        volume.current = setVolume(getVolume() + (k === 'arrowup' ? 0.1 : -0.1));
        flashHud({ kind: 'volume', value: volume.current }, 600);
      } else if (k === 'm') cycleMode();
      else if (k === 'c') {
        if (prefs.mode === 'off') setMode('memc');
        setCompare((c) => !c);
      } else if (k === 'v') setVectors((v) => !v);
      else if (k === 'f') toggleFullscreen();
      else return;
      e.preventDefault();
      poke();
    };
  });
  useEffect(() => {
    if (!isWeb) return;
    const onKey = (e: KeyboardEvent) => keys.current(e);
    let last = 0;
    const onMove = () => {
      const now = Date.now();
      if (now - last > 400) {
        last = now;
        poke();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointermove', onMove);
    };
  }, [poke]);

  // ---- the picture's on-screen rectangle (for the split handle)
  const videoW = info?.width || Number(params.w) || 16;
  const videoH = info?.height || Number(params.h) || 9;
  const rect = useMemo(() => {
    if (resizeMode === 'fill') return { x: 0, w: width };
    const s = resizeMode === 'fit' ? Math.min(width / videoW, height / videoH) : Math.max(width / videoW, height / videoH);
    const w = videoW * s;
    return { x: (width - w) / 2, w };
  }, [resizeMode, width, height, videoW, videoH]);
  const splitDrag = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onUpdate((e) => setSplit(clamp((e.absoluteX - rect.x) / rect.w, 0.02, 0.98)));

  // ---- labels
  const sourceFps = stats?.sourceFps || info?.frameRate || 0;
  const outFps = prefs.mode === 'off' ? sourceFps * rate : prefs.targetFps || display.maxRefreshRate;
  const rateLabel = sourceFps > 0 ? `${formatFps(sourceFps)}→${Math.round(outFps)}` : '';
  const shownPosition = scrubMs ?? pos.positionMs;

  if (fatal) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar hidden />
        <Icon ios="exclamationmark.triangle" md="error" size={40} color={Screen.accent} />
        <ThemedText type="subtitle" color={Screen.text} style={{ textAlign: 'center' }}>
          Can’t play this video
        </ThemedText>
        <ThemedText color={Screen.textDim} style={{ textAlign: 'center', maxWidth: 420 }}>
          {fatal}
        </ThemedText>
        <Button label="Back" onPress={goBack} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {isWeb ? null : <NavigationBar hidden />}
      <GlidePlayer
        ref={ref}
        style={StyleSheet.absoluteFill}
        source={source}
        paused={paused}
        rate={rate}
        mode={prefs.mode}
        quality={prefs.quality}
        targetFps={prefs.targetFps}
        compare={compare && prefs.mode !== 'off'}
        split={split}
        showVectors={vectors}
        resizeMode={resizeMode}
        pipEnabled={prefs.pip}
        backgroundAudio={prefs.backgroundAudio}
        subtitlesVisible
        subtitleStyle={prefs.subtitleStyle}
        audioDelayMs={audioDelayMs}
        subtitleDelayMs={subtitleDelayMs}
        onLoad={onLoad}
        onProgress={scrubMs == null ? onProgress : undefined}
        onStats={(e) => setStats(e.nativeEvent)}
        onEnd={() => {
          setEnded(true);
          clearResume(id);
        }}
        onError={(e) => (e.nativeEvent.fatal ? setFatal(e.nativeEvent.message) : showToast(e.nativeEvent.message))}
        onTracks={(e) => setTracks(e.nativeEvent)}
        onPlaybackState={(e) => {
          const s = e.nativeEvent;
          setBuffering(s.buffering);
          if (!s.ended) setPaused(!s.playWhenReady);
        }}
        onPipChange={(e) => setPip(e.nativeEvent.active)}
      />

      {pip ? null : (
        <>
          {locked ? (
            <Pressable style={StyleSheet.absoluteFill} onPress={() => flashHud({ kind: 'text', label: 'Controls locked' }, 900)}>
              <Pressable
                onPress={() => setLocked(false)}
                accessibilityRole="button"
                accessibilityLabel="Unlock controls"
                style={[styles.unlock, { bottom: insets.bottom + 24, right: insets.right + 24 }]}>
                <Icon ios="lock.fill" md="lock" size={26} color={Screen.text} />
              </Pressable>
            </Pressable>
          ) : (
            <>
              <GestureLayer
                width={width}
                height={height}
                durationMs={pos.durationMs}
                resizeMode={resizeMode}
                onTap={() => (showControls ? setControls(false) : poke())}
                onDoubleTap={(side) => (side === 'center' ? playPause() : seekBy((side === 'left' ? -1 : 1) * prefs.seekStep * 1000))}
                onSeekSwipe={(offset, done) => {
                  const target = clamp(pos.positionMs + offset, 0, pos.durationMs);
                  if (done) {
                    setScrubMs(null);
                    seekTo(target);
                    flashHud(null);
                  } else {
                    setScrubMs(target);
                    setHud({ kind: 'seek', label: formatOffset(offset), detail: formatTime(target) });
                  }
                }}
                getBrightness={() => (isWeb ? (volume.current = getVolume()) : (brightness.current ?? 0.5))}
                onBrightness={(v, done) => {
                  // Browsers can't change screen brightness: the left side controls volume too.
                  if (isWeb) {
                    volume.current = setVolume(v);
                    if (done) flashHud({ kind: 'volume', value: volume.current }, 600);
                    else setHud({ kind: 'volume', value: volume.current });
                    return;
                  }
                  brightness.current = v;
                  void Brightness.setBrightnessAsync(Math.max(0.01, v)).catch(() => {});
                  if (done) flashHud({ kind: 'brightness', value: v }, 600);
                  else setHud({ kind: 'brightness', value: v });
                }}
                getVolume={() => (volume.current = getVolume())}
                onVolume={(v, done) => {
                  volume.current = setVolume(v);
                  if (done) flashHud({ kind: 'volume', value: volume.current }, 600);
                  else setHud({ kind: 'volume', value: volume.current });
                }}
                onResize={(m) => {
                  setResizeMode(m);
                  flashHud({ kind: 'text', label: RESIZE_LABEL[m] }, 900);
                }}
              />
              {showControls ? (
                <PlayerControls
                  insets={insets}
                  title={title}
                  paused={paused}
                  ended={ended}
                  buffering={buffering}
                  positionMs={shownPosition}
                  durationMs={pos.durationMs}
                  bufferedMs={pos.bufferedMs}
                  mode={prefs.mode}
                  smoothingAvailable={smoothingAvailable}
                  compare={compare}
                  rate={rate}
                  resizeMode={resizeMode}
                  seekStep={prefs.seekStep}
                  rateLabel={smoothingAvailable ? rateLabel : ''}
                  onBack={goBack}
                  onPlayPause={() => {
                    playPause();
                    poke();
                  }}
                  onSeekBy={(d) => {
                    seekBy(d);
                    poke();
                  }}
                  onScrub={(ms) => {
                    setScrubMs(ms);
                    poke();
                  }}
                  onScrubEnd={(ms) => {
                    setScrubMs(null);
                    seekTo(ms);
                  }}
                  onCycleMode={cycleMode}
                  onToggleCompare={() => {
                    if (prefs.mode === 'off') setMode('memc');
                    setCompare((c) => !c);
                  }}
                  onOpenSmoothing={() => setSheet('smoothing')}
                  onOpenTracks={() => setSheet('tracks')}
                  onOpenSpeed={() => setSheet('speed')}
                  onCycleResize={cycleResize}
                  onRotate={isWeb ? undefined : () => applyOrientation(!(landscape ?? width > height))}
                  onFullscreen={isWeb ? toggleFullscreen : undefined}
                  onLock={() => {
                    setLocked(true);
                    setControls(false);
                  }}
                  onPip={isWeb ? undefined : () => void enterPip()}
                />
              ) : null}
            </>
          )}

          {compare && prefs.mode !== 'off' ? (
            <>
              <GestureDetector gesture={splitDrag}>
                <View style={[styles.splitHandle, { left: rect.x + split * rect.w - 22 }]} accessibilityLabel="Split line" accessibilityHint="Drag to move">
                  <View style={styles.splitKnob}>
                    <Icon ios="arrow.left.and.right" md="code" size={18} color="#15191E" />
                  </View>
                </View>
              </GestureDetector>
              <View pointerEvents="none" style={[styles.compareTags, { top: insets.top + (showControls ? 64 : 12), left: insets.left + 12, right: insets.right + 12 }]}>
                <ThemedText type="label" color={Screen.text} style={styles.tag}>
                  Original
                </ThemedText>
                <ThemedText type="label" color={Screen.onAccent} style={[styles.tag, styles.tagOn]}>
                  {prefs.mode === 'memc' ? 'MEMC' : 'Blend'}
                </ThemedText>
              </View>
            </>
          ) : null}

          {prefs.showStats ? (
            <View pointerEvents="none" style={[styles.stats, { top: insets.top + (showControls ? 64 : 12) + (compare && prefs.mode !== 'off' ? 34 : 0), right: insets.right + 12 }]}>
              {statsLines(stats, sourceFps, prefs.mode, paused).map((line, i) => (
                <ThemedText key={i} font="mono" color={i === 0 ? Screen.text : Screen.textDim} style={styles.statsText}>
                  {line}
                </ThemedText>
              ))}
            </View>
          ) : null}

          <HudPill hud={hud} />

          {toast ? (
            <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + (showControls ? 110 : 40) }]}>
              <ThemedText type="small" color={Screen.text}>
                {toast}
              </ThemedText>
            </View>
          ) : null}
        </>
      )}

      <SmoothingSheet
        visible={sheet === 'smoothing'}
        onClose={() => setSheet(null)}
        available={smoothingAvailable}
        mode={prefs.mode}
        onMode={setMode}
        compare={compare}
        onCompare={(v) => {
          if (v && prefs.mode === 'off') setMode('memc');
          setCompare(v);
        }}
        vectors={vectors}
        onVectors={setVectors}
        targetFps={prefs.targetFps}
        onTargetFps={(v) => setPreference('targetFps', v)}
        refreshRates={display.refreshRates}
        quality={prefs.quality}
        onQuality={(q) => setPreference('quality', q)}
        sourceFps={sourceFps}
        showStats={prefs.showStats}
        onShowStats={(v) => setPreference('showStats', v)}
      />
      <TracksSheet
        visible={sheet === 'tracks'}
        onClose={() => setSheet(null)}
        tracks={tracks}
        onAudio={(t) => {
          void ref.current?.setAudioTrack(t?.id ?? null);
          setSheet(null);
        }}
        onText={(t) => {
          void ref.current?.setTextTrack(t?.id ?? null);
          setSheet(null);
        }}
        onLoadSubtitles={() => void loadSubtitles()}
        audioDelayMs={audioDelayMs}
        onAudioDelay={changeAudioDelay}
        minAudioDelayMs={MIN_AUDIO_DELAY_MS}
        subtitleDelayMs={subtitleDelayMs}
        onSubtitleDelay={changeSubtitleDelay}
        onSubtitleStyle={() => setSheet('subtitleStyle')}
      />
      <SubtitleStyleSheet
        visible={sheet === 'subtitleStyle'}
        onClose={() => setSheet('tracks')}
        value={prefs.subtitleStyle}
        onChange={(st) => setPreference('subtitleStyle', st)}
      />
      <SpeedSheet
        visible={sheet === 'speed'}
        onClose={() => setSheet(null)}
        rate={rate}
        onRate={(r) => {
          setRate(r);
          setSheet(null);
          flashHud({ kind: 'text', label: `${r}×` }, 800);
        }}
      />
    </View>
  );
}

/** The frame-rate readout: what the file has, what reaches the screen, what was made up or lost. */
function statsLines(stats: StatsEvent | null, sourceFps: number, mode: SmoothingMode, paused: boolean): string[] {
  if (!stats) return ['Measuring frame rate…'];
  const shown = Math.round(stats.renderedFps || stats.outputFps);
  const head = `${sourceFps > 0 ? formatFps(sourceFps) : '?'} fps video → ${paused ? 'paused' : `${shown} fps on screen`}`;
  const parts = [`decoded ${formatFps(stats.inputFps)}/s`];
  if (stats.smoothing && mode !== 'off') parts.push(`made ${Math.round(stats.generatedFps)}/s`);
  parts.push(`dropped ${Math.round(stats.droppedFps)}/s`, `${Math.round(stats.displayHz)} Hz`);
  return [head, parts.join(' · '), mode === 'off' || !stats.smoothing ? 'Smoothing off' : stats.motion ? (mode === 'memc' ? 'MEMC active' : 'Blend active') : 'Smoothing idle'];
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Screen.black },
  centered: { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  splitHandle: { position: 'absolute', top: '64%', height: 96, width: 44, alignItems: 'center', justifyContent: 'center' },
  splitKnob: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  compareTags: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between' },
  tag: { backgroundColor: Screen.scrim, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, fontSize: 12, overflow: 'hidden' },
  tagOn: { backgroundColor: Screen.accent },
  unlock: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: Screen.scrim, alignItems: 'center', justifyContent: 'center' },
  stats: { position: 'absolute', backgroundColor: Screen.scrim, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, alignItems: 'flex-end' },
  statsText: { fontSize: 11.5 },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: Screen.scrim, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
});

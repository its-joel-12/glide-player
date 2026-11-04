import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { addExportProgressListener, cancelExport, exportSmooth, isEngineAvailable, type ExportResult } from 'glide-engine';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/button';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { VideoCard } from '@/components/video-card';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { planExport } from '@/lib/cadence';
import { formatBytes, formatResolution, formatTime } from '@/lib/format';
import { openPlayer } from '@/lib/navigation';
import { canUpscale, MAX_INPUT_LONG, MAX_INPUT_SHORT, neuralMinutes, upscaledSize } from '@/lib/upscale-plan';

type Kind = 'smooth' | 'slow' | 'sharp';
type Phase = { state: 'setup' } | { state: 'running'; progress: number } | { state: 'done'; result: ExportResult } | { state: 'error'; message: string };

/** Assumed when the frame rate isn't known yet (the library doesn't report it). */
const ASSUMED_FPS = 30;

function KeepAwake() {
  useKeepAwake('glide-export');
  return null;
}

export default function ExportScreen() {
  const params = useLocalSearchParams<{ id: string; uri: string; title?: string; w?: string; h?: string; d?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const title = params.title || 'Video';
  const width = Number(params.w) || 1920;
  const height = Number(params.h) || 1080;
  const durationMs = Number(params.d) || 0;

  const [kind, setKind] = useState<Kind>('smooth');
  const [fps, setFps] = useState(60);
  const [slow, setSlow] = useState(4);
  const [best, setBest] = useState(true);
  const [keepAudio, setKeepAudio] = useState(true);
  /** AI upscaling with smoothing / slow motion: 1 = off. The "Sharper" copy always upscales (2× or 4×). */
  const [ai, setAi] = useState(1);
  const [sharpFactor, setSharpFactor] = useState(4);
  const [phase, setPhase] = useState<Phase>({ state: 'setup' });
  const running = useRef(false);
  /** When the save started, for the time-left estimate. */
  const startedAt = useRef(0);
  const [eta, setEta] = useState('');

  useEffect(
    () =>
      addExportProgressListener((p) => {
        setPhase((ph) => (ph.state === 'running' ? { state: 'running', progress: p } : ph));
        setEta(timeLeft(startedAt.current, p, Date.now()));
      }),
    [],
  );
  // Leaving the screen stops a running save (nothing would be left to show the result).
  useEffect(
    () => () => {
      if (running.current) void cancelExport();
    },
    [],
  );

  const slowMotion = kind === 'slow' ? slow : 1;
  const audio = kind === 'slow' ? keepAudio && slow <= 2 : keepAudio;
  const aiAllowed = canUpscale(width, height);
  const upscale = !aiAllowed ? 1 : kind === 'sharp' ? sharpFactor : ai;
  const outSize = upscale > 1 ? upscaledSize(width, height, upscale) : null;
  const [outW, outH] = outSize ?? [width, height];
  const smoothing = kind !== 'sharp';
  const plan = useMemo(() => {
    if (smoothing) return planExport(durationMs, ASSUMED_FPS, fps, slowMotion, outW, outH);
    const frames = Math.round((durationMs / 1000) * ASSUMED_FPS);
    return { durationMs, frames, generatedShare: 0, approxBytes: (outW * outH * 0.12 * frames) / 8 };
  }, [smoothing, durationMs, fps, slowMotion, outW, outH]);
  const sourceFrames = Math.round((durationMs / 1000) * ASSUMED_FPS);
  const [aiLow, aiHigh] = outSize ? neuralMinutes(sourceFrames, width, height) : [0, 0];
  const memcLow = smoothing ? Math.max(1, Math.round(plan.frames / 90 / 60)) : 0;
  const memcHigh = smoothing ? Math.max(memcLow + 1, Math.round(plan.frames / 25 / 60)) : 0;
  const minutesLow = memcLow + aiLow;
  const minutesHigh = memcHigh + aiHigh;
  const canSave = kind !== 'sharp' || outSize != null;

  const start = async () => {
    running.current = true;
    startedAt.current = Date.now();
    setEta('');
    setPhase({ state: 'running', progress: 0 });
    try {
      const result = await exportSmooth({
        uri: params.uri,
        title,
        fps: smoothing ? fps : 0,
        slowMotion,
        quality: best ? 'export' : 'balanced',
        keepAudio: audio,
        width,
        height,
        upscale: outSize ? upscale : 1,
      });
      setPhase({ state: 'done', result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase(/cancel/i.test(message) ? { state: 'setup' } : { state: 'error', message });
    } finally {
      running.current = false;
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      {phase.state === 'running' ? <KeepAwake /> : null}
      <View style={styles.header}>
        <IconButton icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={() => router.back()} />
        <ThemedText type="subtitle" accessibilityRole="header">
          Save a copy
        </ThemedText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <View style={styles.preview}>
          <VideoCard id={params.id} uri={params.uri} title={title} durationMs={durationMs} width={width} height={height} onPress={() => openPlayer({ id: params.id, uri: params.uri, title, width, height })} />
        </View>

        {!isEngineAvailable ? (
          <ThemedText themeColor="danger">Saving smooth videos needs the Android app.</ThemedText>
        ) : phase.state === 'setup' || phase.state === 'error' ? (
          <>
            <ThemedText themeColor="textSecondary">
              {kind === 'sharp'
                ? 'A small AI network (Real-ESRGAN) redraws every frame 2× or 4× bigger, rebuilding edges, text and texture and cleaning up compression blocks. Best for low-resolution or pixelated videos. It takes much longer than playback.'
                : 'Glide works out how everything moves between frames (optical flow, like a retime in a video editor) and draws the missing frames. It takes longer than playback but looks sharper.'}
            </ThemedText>

            <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
              Make
            </ThemedText>
            <Segmented
              options={[
                { value: 'smooth', label: 'Smoother' },
                { value: 'slow', label: 'Slow motion' },
                { value: 'sharp', label: 'Sharper' },
              ]}
              value={kind}
              onChange={setKind}
            />

            {kind === 'sharp' ? (
              <>
                <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
                  Bigger by
                </ThemedText>
                <Segmented
                  options={[2, 4].map((v) => ({ value: v, label: `${v}×`, disabled: !aiAllowed || upscaledSize(width, height, v) == null }))}
                  value={sharpFactor}
                  onChange={setSharpFactor}
                />
                {!aiAllowed ? (
                  <ThemedText themeColor="danger">
                    AI upscaling is for videos up to {MAX_INPUT_LONG}×{MAX_INPUT_SHORT} (720p). This one is {width}×{height}.
                  </ThemedText>
                ) : outSize == null ? (
                  <ThemedText themeColor="danger">This video is already as big as a copy can be (4K).</ThemedText>
                ) : null}
              </>
            ) : null}

            {kind === 'slow' ? (
              <>
                <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
                  Slower by
                </ThemedText>
                <Segmented
                  options={[2, 4, 8].map((v) => ({ value: v, label: `${v}×` }))}
                  value={slow}
                  onChange={setSlow}
                />
              </>
            ) : null}

            {smoothing ? (
              <>
                <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
                  Frame rate of the copy
                </ThemedText>
                <Segmented options={[30, 60, 120].map((v) => ({ value: v, label: `${v} fps` }))} value={fps} onChange={setFps} />

                <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
                  Analysis
                </ThemedText>
                <Segmented
                  options={[
                    { value: 1, label: 'Best' },
                    { value: 0, label: 'Faster' },
                  ]}
                  value={best ? 1 : 0}
                  onChange={(v) => setBest(v === 1)}
                />

                {aiAllowed ? (
                  <>
                    <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
                      AI upscaling
                    </ThemedText>
                    <Segmented
                      options={[1, 2, 4].map((v) => ({ value: v, label: v === 1 ? 'Off' : `${v}×`, disabled: v > 1 && upscaledSize(width, height, v) == null }))}
                      value={ai}
                      onChange={setAi}
                    />
                    <ThemedText type="caption" themeColor="textSecondary">
                      Makes the copy bigger and sharper before smoothing. Adds a lot of time.
                    </ThemedText>
                  </>
                ) : null}
              </>
            ) : null}

            <View style={styles.toggle}>
              <View style={{ flex: 1 }}>
                <ThemedText>{kind === 'slow' ? 'Keep the sound (slowed down)' : 'Keep the sound'}</ThemedText>
                {kind === 'slow' && slow > 2 ? (
                  <ThemedText type="caption" themeColor="textSecondary">
                    Sound is dropped at 4× and 8×.
                  </ThemedText>
                ) : null}
              </View>
              <Switch
                value={audio}
                disabled={kind === 'slow' && slow > 2}
                onValueChange={setKeepAudio}
                trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                thumbColor={theme.surface}
                accessibilityLabel="Keep the sound"
              />
            </View>

            <View style={[styles.plan, { borderColor: theme.border, backgroundColor: theme.surface }]}>
              <PlanRow label="Length" value={formatTime(plan.durationMs)} />
              <PlanRow
                label="Picture"
                value={`${outSize ? `${width}×${height} → ${outW}×${outH}` : formatResolution(width, height) || `${width}×${height}`} · ${smoothing ? `${fps} fps` : 'same fps'}`}
              />
              <PlanRow
                label="Frames"
                value={smoothing ? `${plan.frames.toLocaleString()} (${Math.round(plan.generatedShare * 100)}% made by Glide)` : `${plan.frames.toLocaleString()}, each redrawn by the AI`}
              />
              <PlanRow label="Size" value={`about ${formatBytes(plan.approxBytes)}`} />
              <PlanRow label="Time" value={durationMs ? `about ${minutesLow}–${minutesHigh} min` : 'depends on length'} />
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              Estimates assume {ASSUMED_FPS} fps footage. Keep this screen open while it saves. The copy goes to Movies/Glide; the original isn’t changed.
            </ThemedText>

            {phase.state === 'error' ? <ThemedText themeColor="danger">Couldn’t save the video: {phase.message}</ThemedText> : null}
            <Button label="Save copy" icon={{ ios: 'square.and.arrow.down', md: 'download' }} disabled={!canSave} onPress={() => void start()} />
          </>
        ) : phase.state === 'running' ? (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">Saving… {phase.progress}%</ThemedText>
            <View style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.barFill, { width: `${phase.progress}%`, backgroundColor: theme.accent }]} />
            </View>
            <ThemedText themeColor="textSecondary">
              {upscale > 1 && outSize
                ? smoothing
                  ? 'The AI is redrawing every frame bigger, then Glide draws the in-between frames.'
                  : 'The AI is redrawing every frame bigger.'
                : 'Glide is estimating motion and drawing the in-between frames.'}{' '}
              Keep this screen open{upscale > 1 && outSize ? ' and the phone plugged in' : ''}.
              {eta}
            </ThemedText>
            <Button label="Cancel" variant="secondary" onPress={() => void cancelExport()} />
          </View>
        ) : (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">Saved</ThemedText>
            <ThemedText themeColor="textSecondary">
              {phase.result.savedToGallery ? `In your gallery under Movies/Glide as ${phase.result.name}` : phase.result.name} ·{' '}
              {formatBytes(phase.result.fileSizeBytes)}
            </ThemedText>
            {phase.result.notes?.map((n) => (
              <ThemedText key={n} type="caption" themeColor="textSecondary">
                {n}
              </ThemedText>
            ))}
            <Button
              label="Play it"
              icon={{ ios: 'play.fill', md: 'play_arrow' }}
              onPress={() => openPlayer({ id: phase.result.uri, uri: phase.result.uri, title: phase.result.name.replace(/\.mp4$/, '') })}
            />
            <Button
              label="Share"
              variant="secondary"
              icon={{ ios: 'square.and.arrow.up', md: 'share' }}
              onPress={() => void Sharing.shareAsync(phase.result.fileUri, { mimeType: 'video/mp4', dialogTitle: phase.result.name })}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** " About 12 min left." once there's enough progress to tell. */
function timeLeft(startedAt: number, progress: number, now: number): string {
  if (!startedAt || progress < 2 || progress >= 100) return '';
  const elapsed = (now - startedAt) / 1000;
  const left = (elapsed * (100 - progress)) / progress;
  if (left < 90) return ' Less than 2 min left.';
  return left < 3600 ? ` About ${Math.round(left / 60)} min left.` : ` About ${(left / 3600).toFixed(1)} h left.`;
}

function PlanRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.planRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small" font="mono" style={{ flexShrink: 1, textAlign: 'right' }}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: 640, alignSelf: 'center' },
  preview: { maxWidth: MaxContentWidth, marginBottom: Spacing.two },
  label: { marginTop: Spacing.two },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginTop: Spacing.two },
  plan: { borderWidth: 1, borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two, marginTop: Spacing.two },
  planRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.three },
  progressBox: { gap: Spacing.three, marginTop: Spacing.three },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8 },
});

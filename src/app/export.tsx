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

type Kind = 'smooth' | 'slow';
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
  const [phase, setPhase] = useState<Phase>({ state: 'setup' });
  const running = useRef(false);

  useEffect(() => addExportProgressListener((p) => setPhase((ph) => (ph.state === 'running' ? { state: 'running', progress: p } : ph))), []);
  // Leaving the screen stops a running save (nothing would be left to show the result).
  useEffect(
    () => () => {
      if (running.current) void cancelExport();
    },
    [],
  );

  const slowMotion = kind === 'slow' ? slow : 1;
  const audio = kind === 'smooth' ? keepAudio : keepAudio && slow <= 2;
  const plan = useMemo(() => planExport(durationMs, ASSUMED_FPS, fps, slowMotion, width, height), [durationMs, fps, slowMotion, width, height]);
  const minutesLow = Math.max(1, Math.round(plan.frames / 90 / 60));
  const minutesHigh = Math.max(minutesLow + 1, Math.round(plan.frames / 25 / 60));

  const start = async () => {
    running.current = true;
    setPhase({ state: 'running', progress: 0 });
    try {
      const result = await exportSmooth({
        uri: params.uri,
        title,
        fps,
        slowMotion,
        quality: best ? 'export' : 'balanced',
        keepAudio: audio,
        width,
        height,
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
          Smooth copy
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
              Glide works out how everything moves between frames (optical flow, like a retime in a video editor) and draws the missing
              frames. It takes longer than playback but looks sharper.
            </ThemedText>

            <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
              Make
            </ThemedText>
            <Segmented
              options={[
                { value: 'smooth', label: 'Smoother' },
                { value: 'slow', label: 'Slow motion' },
              ]}
              value={kind}
              onChange={setKind}
            />

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
              <PlanRow label="Picture" value={`${formatResolution(width, height) || `${width}×${height}`} · ${fps} fps`} />
              <PlanRow label="Frames" value={`${plan.frames.toLocaleString()} (${Math.round(plan.generatedShare * 100)}% made by Glide)`} />
              <PlanRow label="Size" value={`about ${formatBytes(plan.approxBytes)}`} />
              <PlanRow label="Time" value={durationMs ? `about ${minutesLow}–${minutesHigh} min` : 'depends on length'} />
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              Estimates assume {ASSUMED_FPS} fps footage. Keep this screen open while it saves. The copy goes to Movies/Glide; the original isn’t changed.
            </ThemedText>

            {phase.state === 'error' ? <ThemedText themeColor="danger">Couldn’t save the video: {phase.message}</ThemedText> : null}
            <Button label="Save copy" icon={{ ios: 'square.and.arrow.down', md: 'download' }} onPress={() => void start()} />
          </>
        ) : phase.state === 'running' ? (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">Saving… {phase.progress}%</ThemedText>
            <View style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.barFill, { width: `${phase.progress}%`, backgroundColor: theme.accent }]} />
            </View>
            <ThemedText themeColor="textSecondary">Glide is estimating motion and drawing the in-between frames. Keep this screen open.</ThemedText>
            <Button label="Cancel" variant="secondary" onPress={() => void cancelExport()} />
          </View>
        ) : (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">Saved</ThemedText>
            <ThemedText themeColor="textSecondary">
              {phase.result.savedToGallery ? `In your gallery under Movies/Glide as ${phase.result.name}` : phase.result.name} ·{' '}
              {formatBytes(phase.result.fileSizeBytes)}
            </ThemedText>
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

import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { addExportProgressListener, cancelExport, exportSmooth, isEngineAvailable, type ExportResult } from 'glide-engine';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { VideoCard } from '@/components/video-card';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatBytes } from '@/lib/format';
import { openPlayer } from '@/lib/navigation';

type Phase = { state: 'setup' } | { state: 'running'; progress: number } | { state: 'done'; result: ExportResult } | { state: 'error'; message: string };

function KeepAwake() {
  useKeepAwake('glide-seekable');
  return null;
}

/**
 * Makes an MP4 copy of a file that has no seek index (some MKVs and recordings), so it can be
 * skipped through and resumed. Streams are copied as they are when MP4 can hold them.
 */
export default function SeekableCopyScreen() {
  const params = useLocalSearchParams<{ id: string; uri: string; title?: string; w?: string; h?: string; d?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const title = params.title || 'Video';
  const width = Number(params.w) || 0;
  const height = Number(params.h) || 0;
  const durationMs = Number(params.d) || 0;

  const [keepAudio, setKeepAudio] = useState(true);
  const [phase, setPhase] = useState<Phase>({ state: 'setup' });
  const running = useRef(false);

  useEffect(() => addExportProgressListener((p) => setPhase((ph) => (ph.state === 'running' ? { state: 'running', progress: p } : ph))), []);
  useEffect(
    () => () => {
      if (running.current) void cancelExport();
    },
    [],
  );

  const start = async () => {
    running.current = true;
    setPhase({ state: 'running', progress: 0 });
    try {
      const result = await exportSmooth({ uri: params.uri, title, remux: true, keepAudio, fps: 30, slowMotion: 1, quality: 'balanced', width, height });
      setPhase({ state: 'done', result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setPhase(/cancel/i.test(message) ? { state: 'setup' } : { state: 'error', message });
    } finally {
      running.current = false;
    }
  };

  const playCopy = (r: ExportResult) => {
    const copy = { id: r.uri, uri: r.uri, title: r.name.replace(/\.mp4$/, ''), width, height, durationMs };
    // This screen took the original player's place, so Back from the copy returns to the library.
    openPlayer(copy, { replace: true });
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      {phase.state === 'running' ? <KeepAwake /> : null}
      <View style={styles.header}>
        <IconButton icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={() => router.back()} />
        <ThemedText type="subtitle" accessibilityRole="header">
          Seekable copy
        </ThemedText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <View style={styles.preview}>
          <VideoCard id={params.id} uri={params.uri} title={title} durationMs={durationMs} width={width} height={height} onPress={() => {}} />
        </View>

        {!isEngineAvailable ? (
          <ThemedText themeColor="danger">Making copies needs the Android app.</ThemedText>
        ) : phase.state === 'setup' || phase.state === 'error' ? (
          <>
            <ThemedText>
              This file has no seek index, so no player can jump around in it or continue where you left off. Glide can write a copy as MP4,
              which always has one.
            </ThemedText>
            <ThemedText themeColor="textSecondary">
              The picture is copied as it is (no quality loss) when MP4 can hold it; otherwise it is converted. The copy keeps the main audio
              track. Built-in subtitles and extra audio tracks aren’t copied: load a subtitle file in the player if you need them. The original
              isn’t changed.
            </ThemedText>
            <View style={styles.toggle}>
              <ThemedText style={{ flex: 1 }}>Keep the sound</ThemedText>
              <Switch
                value={keepAudio}
                onValueChange={setKeepAudio}
                trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
                thumbColor={theme.surface}
                accessibilityLabel="Keep the sound"
              />
            </View>
            <ThemedText type="caption" themeColor="textSecondary">
              Needs about twice the file’s size in free space while it works. Usually takes a few minutes for a film; keep this screen open.
            </ThemedText>
            {phase.state === 'error' ? (
              <ThemedText themeColor="danger">
                Couldn’t make the copy: {phase.message}
                {keepAudio ? ' If the sound format is the problem (e.g. DTS), try again with the sound off.' : ''}
              </ThemedText>
            ) : null}
            <Button label="Make seekable copy" icon={{ ios: 'square.and.arrow.down', md: 'download' }} onPress={() => void start()} />
          </>
        ) : phase.state === 'running' ? (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">{phase.progress > 0 ? `Copying… ${phase.progress}%` : 'Copying…'}</ThemedText>
            <View style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
              <View style={[styles.barFill, { width: `${Math.max(2, phase.progress)}%`, backgroundColor: theme.accent }]} />
            </View>
            <ThemedText themeColor="textSecondary">Writing the MP4. Keep this screen open.</ThemedText>
            <Button label="Cancel" variant="secondary" onPress={() => void cancelExport()} />
          </View>
        ) : (
          <View style={styles.progressBox}>
            <ThemedText type="subtitle">Done</ThemedText>
            <ThemedText themeColor="textSecondary">
              {phase.result.savedToGallery ? `In your gallery under Movies/Glide as ${phase.result.name}` : phase.result.name} ·{' '}
              {formatBytes(phase.result.fileSizeBytes)}. You can skip around in it and pick up where you stopped.
            </ThemedText>
            <Button label="Play the copy" icon={{ ios: 'play.fill', md: 'play_arrow' }} onPress={() => playCopy(phase.result)} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: 640, alignSelf: 'center' },
  preview: { maxWidth: MaxContentWidth },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  progressBox: { gap: Spacing.three, marginTop: Spacing.three },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8 },
});

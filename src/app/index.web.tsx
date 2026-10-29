import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/button';
import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Wordmark } from '@/components/wordmark';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatTime } from '@/lib/format';
import { DEMO_VIDEO, openPlayer, pickVideoFile, videoFromFile } from '@/lib/navigation';
import { continueWatching, progressFraction, useResumeEntries } from '@/lib/resume';

/** Web home: open a file (button or drag and drop), try the demo, see what you were watching. */
export default function WebHome() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const recent = continueWatching(useResumeEntries(), 8);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('video') || /\.(mp4|m4v|webm|mov|mkv|ogv)$/i.test(f.name));
      if (file) openPlayer(videoFromFile(file));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const open = async () => {
    const v = await pickVideoFile();
    if (v) openPlayer(v);
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={[styles.page, { paddingTop: insets.top + Spacing.two, paddingBottom: insets.bottom + Spacing.five }]}>
      <View style={styles.header}>
        <Wordmark />
        <IconButton icon={{ ios: 'gearshape', md: 'settings' }} label="Settings" onPress={() => router.push('/settings')} />
      </View>

      <View style={styles.hero}>
        <ThemedText type="title" style={styles.heroTitle}>
          Make any video play smoother
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.lead}>
          Glide draws the in-between frames your video is missing, like the MEMC setting on phones and TVs, so a 24 or 30 fps video fills
          every refresh of your screen. Your file stays on this device; nothing is uploaded.
        </ThemedText>
      </View>

      <Pressable
        onPress={() => void open()}
        accessibilityRole="button"
        accessibilityLabel="Open a video file"
        style={({ pressed }) => [
          styles.drop,
          { borderColor: dragging ? theme.accent : theme.border, backgroundColor: dragging ? theme.accentSoft : theme.surface },
          pressed && { opacity: 0.85 },
        ]}>
        <Icon ios="film" md="movie" size={36} color={theme.accent} />
        <ThemedText type="subtitle">{dragging ? 'Drop to play' : 'Open a video'}</ThemedText>
        <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
          Click to choose a file, or drop one anywhere on this page. MP4 and WebM work in every browser.
        </ThemedText>
      </Pressable>

      <View style={styles.row}>
        <Button label="Watch the demo clip" variant="secondary" icon={{ ios: 'play.fill', md: 'play_arrow' }} onPress={() => openPlayer(DEMO_VIDEO)} style={{ flexGrow: 1 }} />
      </View>
      <ThemedText type="caption" themeColor="textSecondary">
        The demo is a 24 fps city pan. Turn on split compare in the player to see the original next to the smoothed picture.
      </ThemedText>

      {recent.length ? (
        <View style={{ gap: Spacing.two, marginTop: Spacing.three }}>
          <ThemedText type="label" themeColor="textSecondary">
            Recently watched
          </ThemedText>
          {recent.map((e) => {
            const demo = e.id === DEMO_VIDEO.id;
            return (
              <Pressable
                key={e.id}
                onPress={() => (demo ? openPlayer(DEMO_VIDEO) : void open())}
                accessibilityRole="button"
                accessibilityHint={demo ? 'Plays the demo' : 'Open the same file again to continue'}
                style={({ pressed }) => [styles.recent, { borderColor: theme.border, backgroundColor: pressed ? theme.backgroundElement : theme.surface }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {e.title}
                  </ThemedText>
                  <View style={[styles.bar, { backgroundColor: theme.backgroundElement }]}>
                    <View style={[styles.barFill, { width: `${Math.round(progressFraction(e) * 100)}%`, backgroundColor: theme.accent }]} />
                  </View>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {formatTime(e.positionMs)} of {formatTime(e.durationMs)}
                    {demo ? '' : ' · open the file again to continue'}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.note, { borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="textSecondary">
          The Android app also browses your phone’s video library, plays MKV and HEVC, works in picture-in-picture and saves smooth or
          slow-motion copies. Streaming apps such as Netflix, Prime Video and YouTube protect their video, so no player can smooth them.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { paddingHorizontal: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { gap: Spacing.two, marginTop: Spacing.three },
  heroTitle: { fontSize: 40, lineHeight: 44 },
  lead: { maxWidth: 620 },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderRadius: Radius.card + 4, alignItems: 'center', justifyContent: 'center', gap: Spacing.two, paddingVertical: Spacing.five, paddingHorizontal: Spacing.four },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  recent: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, borderWidth: 1, borderRadius: Radius.card, padding: Spacing.three },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4 },
  note: { borderTopWidth: 1, paddingTop: Spacing.three, marginTop: Spacing.three },
});

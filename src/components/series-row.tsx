import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { VideoItem } from '@/lib/library';
import { episodeFromTitle, episodeLabel, nextEpisode, type Series } from '@/lib/series';
import { useThumbnail } from '@/lib/thumbnails';
import { watchedIn } from '@/lib/watched';

/** One series in the Series tab: cover of the next episode, episode count, how many watched, what's next. */
export function SeriesRow({ series, watched, onPress }: { series: Series<VideoItem>; watched: Record<string, number>; onPress: () => void }) {
  const theme = useTheme();
  const count = series.items.length;
  const seen = series.items.filter((v) => watchedIn(watched, v.id)).length;
  const next = nextEpisode(series.items, (v) => watchedIn(watched, v.id));
  const cover = next ?? series.items[0];
  const thumb = useThumbnail(cover.id, cover.uri, cover.durationMs);
  const nextEp = next ? episodeFromTitle(next.title) : null;
  const status = !next ? 'All watched' : seen === 0 ? null : `Next: ${nextEp ? episodeLabel(nextEp) : next.title}`;
  const info = `${count} episodes${seen ? ` · ${seen} watched` : ''}`;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${series.title}, ${info}${status ? `, ${status}` : ''}`}
      style={({ pressed }) => [styles.row, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        <View style={[styles.progress, { backgroundColor: theme.border }]}>
          <View style={{ width: `${(seen / count) * 100}%`, height: '100%', backgroundColor: theme.accent }} />
        </View>
      </View>
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {series.title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {info}
        </ThemedText>
        {status ? (
          <ThemedText type="caption" themeColor={next ? 'accentText' : 'textSecondary'} numberOfLines={1}>
            {status}
          </ThemedText>
        ) : null}
      </View>
      <Icon ios="chevron.right" md="chevron_right" size={20} color={theme.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  cover: { width: 96, aspectRatio: 16 / 9, borderRadius: Radius.thumb, overflow: 'hidden', justifyContent: 'flex-end' },
  progress: { height: 3, width: '100%' },
  text: { flex: 1, minWidth: 0, gap: 2 },
});

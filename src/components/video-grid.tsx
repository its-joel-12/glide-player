import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VideoActions } from '@/components/video-actions';
import { VideoCard } from '@/components/video-card';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { columnsFor, mergeUnique, toRows } from '@/lib/grid';
import { albumById, fetchVideos, type VideoItem } from '@/lib/library';
import { openPlayer } from '@/lib/navigation';
import { progressFraction, useResumeEntries } from '@/lib/resume';

const PAGE = 60;

type Props = {
  /** Only videos in this folder. */
  albumId?: string;
  /** Shown above the grid (scrolls with it). */
  header?: ReactElement | null;
  emptyText: string;
};

/**
 * Grid of videos, newest first, loading more as you scroll.
 * Rows are built here (one list item per row) instead of FlatList's numColumns, so rotating the
 * phone just regroups the rows, and every key stays unique even if pages overlap.
 */
export function VideoGrid({ albumId, header, emptyText }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const resume = useResumeEntries();
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<VideoItem | null>(null);
  const done = useRef(false);
  const busy = useRef(false);
  /** Bumped on every reset; answers to older requests are ignored. */
  const generation = useRef(0);

  const columns = columnsFor(Math.min(width, MaxContentWidth) - Spacing.three * 2, 170, Spacing.three);
  const rows = toRows(items, columns);

  const load = async (reset: boolean) => {
    if (!reset && (busy.current || done.current)) return;
    const gen = reset ? ++generation.current : generation.current;
    busy.current = true;
    try {
      const page = await fetchVideos({ album: albumId ? albumById(albumId) : undefined, offset: reset ? 0 : items.length, limit: PAGE });
      if (gen !== generation.current) return;
      done.current = page.length < PAGE;
      setItems((prev) => (reset ? mergeUnique([], page) : mergeUnique(prev, page)));
      setError(null);
    } catch (e) {
      if (gen === generation.current) setError(e instanceof Error ? e.message : 'Couldn’t read your videos.');
    } finally {
      if (gen === generation.current) {
        busy.current = false;
        setRefreshing(false);
        setLoading(false);
      }
    }
  };

  // First page whenever the folder changes.
  useEffect(() => {
    const gen = ++generation.current;
    done.current = false;
    busy.current = true;
    fetchVideos({ album: albumId ? albumById(albumId) : undefined, offset: 0, limit: PAGE })
      .then((page) => {
        if (gen !== generation.current) return;
        done.current = page.length < PAGE;
        setItems(mergeUnique([], page));
        setError(null);
      })
      .catch((e: unknown) => {
        if (gen === generation.current) setError(e instanceof Error ? e.message : 'Couldn’t read your videos.');
      })
      .finally(() => {
        if (gen !== generation.current) return;
        busy.current = false;
        setLoading(false);
      });
  }, [albumId]);

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(row) => row[0].id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        onEndReachedThreshold={0.6}
        onEndReached={() => void load(false)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        renderItem={({ item: row }) => (
          <View style={styles.row}>
            {row.map((item) => (
              <VideoCard
                key={item.id}
                {...item}
                progress={progressFraction(resume[item.id])}
                onPress={() => openPlayer(item)}
                onLongPress={() => setActionsFor(item)}
              />
            ))}
            {/* keep the last row's cards the same width as the others */}
            {Array.from({ length: columns - row.length }, (_, i) => (
              <View key={`pad${i}`} style={styles.pad} />
            ))}
          </View>
        )}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={theme.accent} style={{ marginTop: Spacing.five }} />
          ) : (
            <View style={styles.empty}>
              <ThemedText themeColor="textSecondary" style={{ textAlign: 'center' }}>
                {error ?? emptyText}
              </ThemedText>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: Spacing.five }} />}
      />
      <VideoActions video={actionsFor} onClose={() => setActionsFor(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  row: { flexDirection: 'row', gap: Spacing.three },
  pad: { flex: 1 },
  empty: { paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
});

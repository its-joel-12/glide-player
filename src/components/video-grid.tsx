import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { VideoActions } from '@/components/video-actions';
import { VideoCard } from '@/components/video-card';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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

/** Grid of videos, newest first, loading more as you scroll. */
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

  const contentWidth = Math.min(width, MaxContentWidth) - Spacing.three * 2;
  const columns = Math.max(2, Math.floor((contentWidth + Spacing.three) / (170 + Spacing.three)));

  const loadMore = async (reset: boolean) => {
    if (busy.current || (!reset && done.current)) return;
    busy.current = true;
    try {
      const page = await fetchVideos({ album: albumId ? albumById(albumId) : undefined, offset: reset ? 0 : items.length, limit: PAGE });
      done.current = page.length < PAGE;
      setItems((prev) => (reset ? page : [...prev, ...page]));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read your videos.');
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  };

  // First page whenever the folder changes.
  useEffect(() => {
    let alive = true;
    done.current = false;
    busy.current = true;
    fetchVideos({ album: albumId ? albumById(albumId) : undefined, offset: 0, limit: PAGE })
      .then((page) => {
        if (!alive) return;
        done.current = page.length < PAGE;
        setItems(page);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Couldn’t read your videos.'))
      .finally(() => {
        busy.current = false;
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [albumId]);

  const rows = items;
  return (
    <>
      <FlatList
        key={columns}
        data={rows}
        numColumns={columns}
        keyExtractor={(v) => v.id}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.content}
        onEndReachedThreshold={0.6}
        onEndReached={() => void loadMore(false)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              done.current = false;
              void loadMore(true);
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        renderItem={({ item }) => (
          <VideoCard
            {...item}
            progress={progressFraction(resume[item.id])}
            onPress={() => openPlayer(item)}
            onLongPress={() => setActionsFor(item)}
          />
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
  row: { gap: Spacing.three },
  empty: { paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
});

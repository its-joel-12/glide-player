import { useEffect, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';

import { IconButton } from '@/components/button';
import { Icon } from '@/components/icon';
import { Sheet, SheetOption } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { VideoActions } from '@/components/video-actions';
import { VideoCard } from '@/components/video-card';
import { VideoRow } from '@/components/video-row';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { columnsFor, mergeUnique, toRows } from '@/lib/grid';
import { albumById, fetchAllVideos, type VideoItem } from '@/lib/library';
import { LIBRARY_SORTS, sortVideos } from '@/lib/library-sort';
import { openPlayer } from '@/lib/navigation';
import { setPreference, usePreferences } from '@/lib/preferences';
import { progressFraction, useResumeEntries } from '@/lib/resume';
import { useWatched, watchedIn } from '@/lib/watched';

type Props = {
  /** Only videos in this folder. */
  albumId?: string;
  /** Shown above the list (scrolls with it). */
  header?: ReactElement | null;
  /** Label left of the sort and view buttons, e.g. "All videos". */
  title?: string;
  emptyText: string;
};

/**
 * The videos as a grid of big thumbnails or a list with small ones, sorted as chosen
 * (newest, oldest, name, length). Grid rows are built here instead of with FlatList's
 * numColumns, so rotating the phone just regroups them and keys stay unique.
 */
export function VideoGrid({ albumId, header, title, emptyText }: Props) {
  const theme = useTheme();
  const prefs = usePreferences();
  const { width } = useWindowDimensions();
  const resume = useResumeEntries();
  const watched = useWatched();
  const [items, setItems] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<VideoItem | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  /** Bumped on every load; answers to older requests are ignored. */
  const generation = useRef(0);

  const list = prefs.libraryView === 'list';
  const sorted = sortVideos(items, prefs.librarySort);
  const columns = list ? 1 : columnsFor(Math.min(width, MaxContentWidth) - Spacing.three * 2, 170, Spacing.three);
  const rows = toRows(sorted, columns);
  const sortLabel = LIBRARY_SORTS.find((s) => s.value === prefs.librarySort)?.label ?? '';

  const load = (gen: number) =>
    fetchAllVideos(albumId ? albumById(albumId) : undefined)
      .then((all) => {
        if (gen !== generation.current) return;
        setItems(mergeUnique([], all));
        setError(null);
      })
      .catch((e: unknown) => {
        if (gen === generation.current) setError(e instanceof Error ? e.message : 'Couldn’t read your videos.');
      })
      .finally(() => {
        if (gen !== generation.current) return;
        setLoading(false);
        setRefreshing(false);
      });

  useEffect(() => {
    void load(++generation.current);
  }, [albumId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toolbar = (
    <View style={styles.toolbar}>
      <ThemedText type="label" themeColor="textSecondary" style={{ flex: 1 }} numberOfLines={1}>
        {title ? `${title}${items.length ? ` · ${items.length}` : ''}` : items.length ? `${items.length} videos` : ''}
      </ThemedText>
      <Pressable
        onPress={() => setSortOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Sort: ${sortLabel}`}
        style={({ pressed }) => [styles.sort, { borderColor: theme.border }, pressed && { opacity: 0.7 }]}>
        <Icon ios="arrow.up.arrow.down" md="sort" size={16} color={theme.textSecondary} />
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {sortLabel}
        </ThemedText>
      </Pressable>
      <IconButton
        icon={list ? { ios: 'square.grid.2x2', md: 'grid_view' } : { ios: 'list.bullet', md: 'view_list' }}
        label={list ? 'Show as grid' : 'Show as list'}
        onPress={() => setPreference('libraryView', list ? 'grid' : 'list')}
        size={20}
      />
    </View>
  );

  return (
    <>
      <FlatList
        data={rows}
        key={list ? 'list' : 'grid'}
        keyExtractor={(row) => row[0].id}
        ListHeaderComponent={
          <View>
            {header}
            {toolbar}
          </View>
        }
        contentContainerStyle={[styles.content, list && { gap: Spacing.one }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(++generation.current);
            }}
            tintColor={theme.accent}
            colors={[theme.accent]}
          />
        }
        renderItem={({ item: row }) =>
          list ? (
            <VideoRow
              {...row[0]}
              progress={progressFraction(resume[row[0].id])}
              watched={watchedIn(watched, row[0].id)}
              onPress={() => openPlayer(row[0])}
              onMore={() => setActionsFor(row[0])}
            />
          ) : (
            <View style={styles.row}>
              {row.map((item) => (
                <VideoCard
                  key={item.id}
                  {...item}
                  progress={progressFraction(resume[item.id])}
                  watched={watchedIn(watched, item.id)}
                  onPress={() => openPlayer(item)}
                  onLongPress={() => setActionsFor(item)}
                />
              ))}
              {/* keep the last row's cards the same width as the others */}
              {Array.from({ length: columns - row.length }, (_, i) => (
                <View key={`pad${i}`} style={styles.pad} />
              ))}
            </View>
          )
        }
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
        initialNumToRender={list ? 14 : 8}
        windowSize={9}
      />
      <VideoActions video={actionsFor} onClose={() => setActionsFor(null)} onDeleted={(v) => setItems((all) => all.filter((x) => x.id !== v.id))} />
      <Sheet visible={sortOpen} title="Sort videos" onClose={() => setSortOpen(false)}>
        {LIBRARY_SORTS.map((s) => (
          <SheetOption
            key={s.value}
            label={s.label}
            selected={s.value === prefs.librarySort}
            onPress={() => {
              setPreference('librarySort', s.value);
              setSortOpen(false);
            }}
          />
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
  row: { flexDirection: 'row', gap: Spacing.three },
  pad: { flex: 1 },
  empty: { paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
});

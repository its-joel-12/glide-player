import { shareVideos } from 'glide-engine';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { ActivityIndicator, Alert, BackHandler, FlatList, Keyboard, Pressable, RefreshControl, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/button';
import { Icon } from '@/components/icon';
import { Sheet, SheetOption } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { confirmAndDelete, VideoActions } from '@/components/video-actions';
import { VideoCard } from '@/components/video-card';
import { VideoRow } from '@/components/video-row';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { columnsFor, mergeUnique, toRows } from '@/lib/grid';
import { albumById, fetchAllVideos, type VideoItem } from '@/lib/library';
import { matchesWords, normalizeForSearch, queryWords } from '@/lib/library-search';
import { LIBRARY_SORTS, sortVideos } from '@/lib/library-sort';
import { openPlayer } from '@/lib/navigation';
import { setPreference, usePreferences } from '@/lib/preferences';
import { clearResumeMany, progressFraction, useResumeEntries } from '@/lib/resume';
import { pruneSelection, selectAllToggle, toggleSelected, type Selection } from '@/lib/selection';
import { setWatchedMany, useWatched, watchedIn } from '@/lib/watched';

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
 *
 * Long-press a video (or the select button) to pick several; a bar at the bottom then shares,
 * deletes or marks them watched. Back or ✕ stops picking. The ⋮ menu is for one video.
 *
 * The search button turns the toolbar into a search field that filters by file name (every word,
 * any order, case and accents ignored); the header (Continue watching) is hidden meanwhile, the
 * sort still applies, and picking works on the results. Back or ✕ closes the search.
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
  const [selection, setSelection] = useState<Selection>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** Filtering lags the typing slightly on huge libraries instead of making each key wait for it. */
  const deferredQuery = useDeferredValue(query);
  const insets = useSafeAreaInsets();
  /** Bumped on every load; answers to older requests are ignored. */
  const generation = useRef(0);

  const list = prefs.libraryView === 'list';
  /** Names prepared for matching once per load, not on every key press. */
  const searchNames = useMemo(() => new Map(items.map((v) => [v.id, normalizeForSearch(v.title)])), [items]);
  const words = searchOpen ? queryWords(deferredQuery) : [];
  const filtering = words.length > 0;
  const shown = filtering ? items.filter((v) => matchesWords(searchNames.get(v.id) ?? '', words)) : items;
  const sorted = sortVideos(shown, prefs.librarySort);
  const columns = list ? 1 : columnsFor(Math.min(width, MaxContentWidth) - Spacing.three * 2, 170, Spacing.three);
  const rows = toRows(sorted, columns);
  const sortLabel = LIBRARY_SORTS.find((s) => s.value === prefs.librarySort)?.label ?? '';

  const selecting = selection !== null;
  /** Picked videos, in the order shown. */
  const picked = selection ? sorted.filter((v) => selection.has(v.id)) : [];
  const allPicked = picked.length > 0 && picked.length === sorted.length;
  const allWatched = picked.length > 0 && picked.every((v) => watchedIn(watched, v.id));
  const tap = (v: VideoItem) => (selecting ? setSelection((s) => toggleSelected(s, v.id)) : openPlayer(v));
  const longPress = (v: VideoItem) => setSelection((s) => toggleSelected(s, v.id));

  const closeSearch = () => {
    Keyboard.dismiss();
    setQuery('');
    setSearchOpen(false);
  };

  // Android back stops picking, then closes the search, before it leaves the screen.
  useEffect(() => {
    if (!selecting && !searchOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selecting) setSelection(null);
      else closeSearch();
      return true;
    });
    return () => sub.remove();
  }, [selecting, searchOpen]);

  const sharePicked = () => {
    if (!picked.length) return;
    const one = picked.length === 1;
    shareVideos(
      picked.map((v) => v.uri),
      one ? picked[0].title : `${picked.length} videos`,
    )
      .then(() => setSelection(null))
      .catch((e: unknown) => Alert.alert(one ? 'Couldn’t share the video' : 'Couldn’t share the videos', e instanceof Error ? e.message : String(e)));
  };
  const deletePicked = () =>
    void confirmAndDelete(picked, (gone) => {
      const ids = new Set(gone.map((v) => v.id));
      setItems((all) => all.filter((x) => !ids.has(x.id)));
      setSelection(null);
    });
  const markPicked = () => {
    const ids = picked.map((v) => v.id);
    setWatchedMany(ids, !allWatched);
    if (!allWatched) clearResumeMany(ids);
    setSelection(null);
  };

  const load = (gen: number) =>
    fetchAllVideos(albumId ? albumById(albumId) : undefined)
      .then((all) => {
        if (gen !== generation.current) return;
        setItems(mergeUnique([], all));
        setSelection((s) => pruneSelection(s, all.map((v) => v.id)));
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

  const searchBar = (
    <View style={styles.toolbar}>
      <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <Icon ios="magnifyingglass" md="search" size={18} color={theme.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={title ? `Search ${title.toLowerCase()}` : 'Search videos'}
          placeholderTextColor={theme.textSecondary}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          accessibilityLabel="Search videos by name"
          style={[styles.searchInput, { color: theme.text }]}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={10}>
            <Icon ios="xmark.circle.fill" md="cancel" size={18} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      <IconButton icon={{ ios: 'xmark', md: 'close' }} label="Close search" onPress={closeSearch} size={20} />
    </View>
  );

  const toolbar = searchOpen ? (
    <View>
      {searchBar}
      {filtering && sorted.length ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.results} accessibilityLiveRegion="polite">
          {sorted.length === 1 ? '1 video' : `${sorted.length} videos`} of {items.length}
        </ThemedText>
      ) : null}
    </View>
  ) : (
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
      <IconButton icon={{ ios: 'magnifyingglass', md: 'search' }} label="Search videos" onPress={() => setSearchOpen(true)} size={20} />
      <IconButton
        icon={{ ios: 'checkmark.circle', md: 'checklist' }}
        label="Select videos"
        onPress={() => setSelection((s) => s ?? new Set())}
        active={selecting}
        size={20}
      />
      <IconButton
        icon={list ? { ios: 'square.grid.2x2', md: 'grid_view' } : { ios: 'list.bullet', md: 'view_list' }}
        label={list ? 'Show as grid' : 'Show as list'}
        onPress={() => setPreference('libraryView', list ? 'grid' : 'list')}
        size={20}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      <FlatList
        data={rows}
        extraData={selection}
        key={list ? 'list' : 'grid'}
        keyExtractor={(row) => row[0].id}
        ListHeaderComponent={
          <View>
            {searchOpen ? null : header}
            {toolbar}
          </View>
        }
        contentContainerStyle={[styles.content, list && { gap: Spacing.one }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
              onPress={() => tap(row[0])}
              onLongPress={() => longPress(row[0])}
              onMore={() => setActionsFor(row[0])}
              selected={!!selection?.has(row[0].id)}
              selecting={selecting}
            />
          ) : (
            <View style={styles.row}>
              {row.map((item) => (
                <VideoCard
                  key={item.id}
                  {...item}
                  progress={progressFraction(resume[item.id])}
                  watched={watchedIn(watched, item.id)}
                  onPress={() => tap(item)}
                  onLongPress={() => longPress(item)}
                  onMore={() => setActionsFor(item)}
                  selected={!!selection?.has(item.id)}
                  selecting={selecting}
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
                {error ?? (filtering && items.length ? `No videos match “${deferredQuery.trim()}”.` : emptyText)}
              </ThemedText>
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: selecting ? 96 + insets.bottom : Spacing.five }} />}
        initialNumToRender={list ? 14 : 8}
        windowSize={9}
      />
      {selecting ? (
        <View style={[styles.barWrap, { bottom: insets.bottom + Spacing.three }]}>
          <View style={[styles.bar, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <IconButton icon={{ ios: 'xmark', md: 'close' }} label="Stop selecting" onPress={() => setSelection(null)} size={20} />
            <ThemedText type="label" numberOfLines={1} style={{ flex: 1 }} accessibilityLiveRegion="polite">
              {picked.length ? `${picked.length} selected` : 'Select videos'}
            </ThemedText>
            <IconButton
              icon={allPicked ? { ios: 'circle', md: 'deselect' } : { ios: 'checklist', md: 'select_all' }}
              label={allPicked ? 'Unselect all' : 'Select all'}
              onPress={() => setSelection((s) => selectAllToggle(s, sorted.map((v) => v.id)))}
              size={20}
            />
            <IconButton
              icon={allWatched ? { ios: 'xmark.circle', md: 'remove_done' } : { ios: 'checkmark.circle', md: 'done_all' }}
              label={allWatched ? 'Mark as not watched' : 'Mark as watched'}
              onPress={markPicked}
              disabled={!picked.length}
              size={20}
            />
            <IconButton icon={{ ios: 'square.and.arrow.up', md: 'share' }} label="Share" onPress={sharePicked} disabled={!picked.length} size={20} />
            <IconButton icon={{ ios: 'trash', md: 'delete' }} label="Delete from phone" onPress={deletePicked} disabled={!picked.length} color={theme.danger} size={20} />
          </View>
        </View>
      ) : null}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  barWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.three },
  bar: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 1,
    borderRadius: 28,
    paddingHorizontal: Spacing.one,
    paddingVertical: Spacing.one,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, marginBottom: Spacing.one },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  results: { marginBottom: Spacing.one },
  sort: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, maxWidth: 180 },
  row: { flexDirection: 'row', gap: Spacing.three },
  pad: { flex: 1 },
  empty: { paddingVertical: Spacing.six, paddingHorizontal: Spacing.four },
});

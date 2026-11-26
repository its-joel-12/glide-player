import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/button';
import { FolderRow } from '@/components/folder-row';
import { SeriesActions } from '@/components/series-actions';
import { SeriesRow } from '@/components/series-row';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { VideoActions } from '@/components/video-actions';
import { VideoCard } from '@/components/video-card';
import { VideoGrid } from '@/components/video-grid';
import { Wordmark } from '@/components/wordmark';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkAccess, chooseMoreVideos, fetchAllVideos, fetchFolders, requestAccess, type Access, type Folder, type VideoItem } from '@/lib/library';
import { openPlayer, pickVideoFile, type VideoRef } from '@/lib/navigation';
import { continueWatching, progressFraction, useResumeEntries } from '@/lib/resume';
import { groupSeries, oneCardPerSeries, seriesName } from '@/lib/series';
import { ungroupSeries, useSeriesOverrides } from '@/lib/series-store';
import { useWatched } from '@/lib/watched';

type Tab = 'videos' | 'series' | 'folders';

export default function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [access, setAccess] = useState<Access>('unknown');
  const [tab, setTab] = useState<Tab>('videos');

  useEffect(() => {
    void checkAccess().then(setAccess);
  }, []);

  const openFile = async () => {
    const v = await pickVideoFile();
    if (v) openPlayer(v);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Wordmark />
        <View style={styles.headerRight}>
          <IconButton icon={{ ios: 'folder', md: 'file_open' }} label="Open a video file" onPress={() => void openFile()} />
          <IconButton icon={{ ios: 'gearshape', md: 'settings' }} label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </View>

      {access === 'granted' || access === 'limited' ? (
        <>
          <View style={styles.tabs}>
            <Segmented
              options={[
                { value: 'videos', label: 'Videos' },
                { value: 'series', label: 'Series' },
                { value: 'folders', label: 'Folders' },
              ]}
              value={tab}
              onChange={setTab}
            />
            {access === 'limited' ? (
              <View style={[styles.banner, { backgroundColor: theme.accentSoft }]}>
                <ThemedText type="small" style={{ flex: 1 }}>
                  Glide can see only the videos you picked.
                </ThemedText>
                <Button label="Choose more" variant="ghost" onPress={() => void chooseMoreVideos()} />
              </View>
            ) : null}
          </View>
          {tab === 'videos' ? (
            <VideoGrid header={<ContinueWatching />} title="All videos" emptyText="No videos on this phone yet." />
          ) : tab === 'series' ? (
            <SeriesList />
          ) : (
            <FolderList />
          )}
        </>
      ) : access === 'unknown' ? null : (
        <AccessGate access={access} onGranted={setAccess} onOpenFile={() => void openFile()} />
      )}
    </View>
  );
}

function ContinueWatching() {
  const entries = useResumeEntries();
  const ov = useSeriesOverrides();
  // One card per series: the episode watched most recently.
  const list = oneCardPerSeries(continueWatching(entries, Infinity), ov).slice(0, 12);
  const [actionsFor, setActionsFor] = useState<VideoRef | null>(null);
  if (!list.length) return actionsFor ? <VideoActions video={actionsFor} onClose={() => setActionsFor(null)} inContinueWatching /> : null;
  return (
    <View style={{ gap: Spacing.two, marginBottom: Spacing.four }}>
      <ThemedText type="label" themeColor="textSecondary" style={styles.sectionLabel}>
        Continue watching
      </ThemedText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.three }}>
        {list.map((e) => (
          <VideoCard
            key={e.id}
            id={e.id}
            uri={e.uri}
            title={e.title}
            durationMs={e.durationMs}
            progress={progressFraction(e)}
            compact
            onPress={() => openPlayer({ id: e.id, uri: e.uri, title: e.title, width: e.width, height: e.height })}
            onMore={() => setActionsFor({ id: e.id, uri: e.uri, title: e.title, width: e.width, height: e.height, durationMs: e.durationMs })}
          />
        ))}
      </ScrollView>
      <VideoActions video={actionsFor} onClose={() => setActionsFor(null)} inContinueWatching />
    </View>
  );
}

/** Videos grouped by series name from the file name (2+ videos with the same name, different episode numbers). */
function SeriesList() {
  const theme = useTheme();
  const watched = useWatched();
  const ov = useSeriesOverrides();
  const [items, setItems] = useState<VideoItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const series = useMemo(() => groupSeries(items ?? [], ov), [items, ov]);
  const load = () =>
    fetchAllVideos()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setRefreshing(false));
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <FlatList
        data={series}
        keyExtractor={(s) => s.key}
        extraData={watched}
        contentContainerStyle={styles.folderList}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          void load();
        }}
        renderItem={({ item }) => (
          <SeriesRow
            series={item}
            watched={watched}
            onPress={() => router.push({ pathname: '/series/[key]', params: { key: item.key } })}
            onMore={() => setActionsFor(item.key)}
          />
        )}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            {items ? 'No series yet. Videos whose names differ only by the episode number, like “Show S01E01” and “Show S01E02”, show up here together.' : 'Looking for series…'}
          </ThemedText>
        }
        ListFooterComponent={
          <View style={{ paddingBottom: Spacing.five }}>
            {ov.ungrouped.length ? (
              <View style={styles.ungrouped}>
                <ThemedText type="label" themeColor="textSecondary" style={styles.sectionLabel}>
                  Ungrouped
                </ThemedText>
                {ov.ungrouped.map((k) => (
                  <View key={k} style={styles.ungroupedRow}>
                    <ThemedText numberOfLines={1} style={{ flex: 1 }}>
                      {seriesName(k, ov)}
                    </ThemedText>
                    <Button label="Group again" variant="ghost" onPress={() => ungroupSeries(k, false)} />
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        }
        style={{ backgroundColor: theme.background }}
      />
      <SeriesActions seriesKey={actionsFor} onClose={() => setActionsFor(null)} />
    </>
  );
}

function FolderList() {
  const theme = useTheme();
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = () =>
    fetchFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
      .finally(() => setRefreshing(false));
  useEffect(() => {
    void load();
  }, []);
  return (
    <FlatList
      data={folders ?? []}
      keyExtractor={(f) => f.id}
      contentContainerStyle={styles.folderList}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      renderItem={({ item }) => <FolderRow folder={item} onPress={() => router.push({ pathname: '/folder/[id]', params: { id: item.id, title: item.title } })} />}
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.emptyText}>
          {folders ? 'No folders with videos.' : 'Looking for folders…'}
        </ThemedText>
      }
      ListFooterComponent={<View style={{ height: Spacing.five }} />}
      style={{ backgroundColor: theme.background }}
    />
  );
}

function AccessGate({ access, onGranted, onOpenFile }: { access: Access; onGranted: (a: Access) => void; onOpenFile: () => void }) {
  const blocked = access === 'blocked';
  return (
    <View style={styles.gate}>
      <ThemedText type="subtitle">Your videos, smoother</ThemedText>
      <ThemedText themeColor="textSecondary">
        Glide plays the videos on your phone with motion smoothing, like the MEMC setting on your display, and can save smooth or
        slow-motion copies. It needs permission to see your videos.
      </ThemedText>
      {blocked ? (
        <Button label="Open app settings" onPress={() => void Linking.openSettings()} />
      ) : (
        <Button label="Allow access to videos" onPress={() => void requestAccess().then(onGranted)} />
      )}
      <Button label="Open a single file instead" variant="secondary" onPress={onOpenFile} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  headerRight: { flexDirection: 'row', gap: Spacing.one },
  tabs: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderRadius: 8, paddingLeft: Spacing.three },
  sectionLabel: { marginBottom: Spacing.one },
  folderList: { paddingHorizontal: Spacing.three, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  emptyText: { textAlign: 'center', marginTop: Spacing.five },
  ungrouped: { marginTop: Spacing.four },
  ungroupedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  gate: { padding: Spacing.four, gap: Spacing.three, maxWidth: 520, alignSelf: 'center', marginTop: Spacing.five },
});

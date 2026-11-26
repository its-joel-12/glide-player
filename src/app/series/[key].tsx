import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/button';
import { SeriesActions } from '@/components/series-actions';
import { ThemedText } from '@/components/themed-text';
import { VideoGrid } from '@/components/video-grid';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { seriesName } from '@/lib/series';
import { useSeriesOverrides } from '@/lib/series-store';

/** The episodes of one series, in order. ⋮ renames, merges or ungroups it. */
export default function SeriesScreen() {
  const { key } = useLocalSearchParams<{ key: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const ov = useSeriesOverrides();
  const [menu, setMenu] = useState(false);
  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <IconButton icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={() => router.back()} />
        <ThemedText type="subtitle" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {key ? seriesName(key, ov) : 'Series'}
        </ThemedText>
        <IconButton icon={{ ios: 'ellipsis', md: 'more_vert' }} label="Series options" onPress={() => setMenu(true)} />
      </View>
      <VideoGrid series={key} title="Episodes" emptyText="No episodes of this series on the phone." />
      <SeriesActions
        seriesKey={menu && key ? key : null}
        onClose={() => setMenu(false)}
        onMerged={(into) => router.setParams({ key: into })}
        onUngrouped={() => router.back()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});

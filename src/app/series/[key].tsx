import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { VideoGrid } from '@/components/video-grid';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function SeriesScreen() {
  const { key, title } = useLocalSearchParams<{ key: string; title?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <IconButton icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={() => router.back()} />
        <ThemedText type="subtitle" numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
          {title || 'Series'}
        </ThemedText>
      </View>
      <VideoGrid series={key} title="Episodes" emptyText="No episodes of this series on the phone." />
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

import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Folder } from '@/lib/library';
import { useThumbnail } from '@/lib/thumbnails';

export function FolderRow({ folder, onPress }: { folder: Folder; onPress: () => void }) {
  const theme = useTheme();
  const cover = folder.cover;
  const thumb = useThumbnail(cover?.id ?? folder.id, cover?.uri ?? '', cover?.durationMs ?? 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${folder.title}, ${folder.count} videos`}
      style={({ pressed }) => [styles.row, { borderColor: theme.border }, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.cover, { backgroundColor: theme.backgroundElement }]}>
        {cover && thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
      </View>
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={1}>
          {folder.title}
        </ThemedText>
        <ThemedText type="caption" themeColor="textSecondary">
          {folder.count === 1 ? '1 video' : `${folder.count} videos`}
        </ThemedText>
      </View>
      <Icon ios="chevron.right" md="chevron_right" size={20} color={theme.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  cover: { width: 96, aspectRatio: 16 / 9, borderRadius: Radius.thumb, overflow: 'hidden' },
  text: { flex: 1, minWidth: 0, gap: 2 },
});

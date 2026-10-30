import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { WatchedTick } from '@/components/video-card';
import { fontFamily, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatDay, formatResolution, formatTime } from '@/lib/format';
import { useThumbnail } from '@/lib/thumbnails';

type Props = {
  id: string;
  uri: string;
  title: string;
  durationMs: number;
  width?: number;
  height?: number;
  modifiedAt?: number;
  progress?: number;
  watched?: boolean;
  onPress: () => void;
  onMore: () => void;
};

/** One line of the list view: small thumbnail, name, details, and a "more" button. */
export function VideoRow({ id, uri, title, durationMs, width, height, modifiedAt, progress = 0, watched, onPress, onMore }: Props) {
  const theme = useTheme();
  const thumb = useThumbnail(id, uri, durationMs);
  const meta = [formatResolution(width, height), formatDay(modifiedAt)].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatTime(durationMs)}${watched ? ', watched' : ''}`}
      accessibilityHint="Plays the video. Long-press for more options."
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundElement }]}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
        {durationMs > 0 ? (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText} color="#FFFFFF" font="mono">
              {formatTime(durationMs)}
            </ThemedText>
          </View>
        ) : null}
        {watched ? <WatchedTick size={18} /> : null}
        {progress > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.accent }]} />
          </View>
        ) : null}
      </View>
      <View style={styles.text}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {title}
        </ThemedText>
        {meta ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {meta}
          </ThemedText>
        ) : null}
      </View>
      <IconButton icon={{ ios: 'ellipsis', md: 'more_vert' }} label={`More options for ${title}`} onPress={onMore} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one, borderRadius: Radius.thumb },
  thumb: { width: 128, aspectRatio: 16 / 9, borderRadius: Radius.thumb, overflow: 'hidden' },
  text: { flex: 1, minWidth: 0, gap: 2 },
  badge: { position: 'absolute', right: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 3, paddingHorizontal: 4 },
  badgeText: { fontSize: 10.5, lineHeight: 15, fontFamily: fontFamily(500, 'mono') },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: 3 },
});

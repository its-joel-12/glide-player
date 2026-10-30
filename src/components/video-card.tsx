import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { fontFamily, Radius } from '@/constants/theme';
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
  /** 0..1 watched, 0 hides the bar. */
  progress?: number;
  /** Watched to the end: a tick on the thumbnail. */
  watched?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  /** Wide cards for the "Continue watching" row. */
  compact?: boolean;
};

export function VideoCard({ id, uri, title, durationMs, width, height, modifiedAt, progress = 0, watched, onPress, onLongPress, compact }: Props) {
  const theme = useTheme();
  const thumb = useThumbnail(id, uri, durationMs);
  const res = formatResolution(width, height);
  const meta = [res, formatDay(modifiedAt)].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatTime(durationMs)}${watched ? ', watched' : ''}`}
      accessibilityHint="Plays the video. Long-press for more options."
      style={({ pressed }) => [styles.card, compact && styles.compact, pressed && { opacity: 0.75 }]}>
      <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]}>
        {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : null}
        {durationMs > 0 ? (
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText} color="#FFFFFF" font="mono">
              {formatTime(durationMs)}
            </ThemedText>
          </View>
        ) : null}
        {watched ? <WatchedTick /> : null}
        {progress > 0 ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%`, backgroundColor: theme.accent }]} />
          </View>
        ) : null}
      </View>
      <ThemedText type="smallBold" numberOfLines={1} style={styles.title}>
        {title}
      </ThemedText>
      {meta && !compact ? (
        <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
          {meta}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** Small accent circle with a tick, top-left of a thumbnail. */
export function WatchedTick({ size = 22 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.tick, { width: size, height: size, borderRadius: size / 2, backgroundColor: theme.accent }]} accessibilityElementsHidden>
      <Icon ios="checkmark" md="check" size={size * 0.68} color={theme.onAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  tick: { position: 'absolute', left: 6, top: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  card: { flex: 1, minWidth: 0, gap: 2 },
  compact: { width: 220, flex: 0 },
  thumb: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.thumb, overflow: 'hidden', marginBottom: 6 },
  badge: { position: 'absolute', right: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontSize: 11.5, lineHeight: 16, fontFamily: fontFamily(500, 'mono') },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: 3 },
  title: { lineHeight: 19 },
});

import { Image } from 'expo-image';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { IconButton } from '@/components/button';
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
  /** Shows a ⋮ button on the thumbnail that opens the video's menu. */
  onMore?: () => void;
  /** Wide cards for the "Continue watching" row. */
  compact?: boolean;
  /** In a list where several can be picked: whether this one is. Leave out where there's no picking. */
  selected?: boolean;
  /** Picking is on: the ⋮ button gives way to a check circle. */
  selecting?: boolean;
};

export function VideoCard({ id, uri, title, durationMs, width, height, modifiedAt, progress = 0, watched, onPress, onLongPress, onMore, compact, selected, selecting }: Props) {
  const theme = useTheme();
  const thumb = useThumbnail(id, uri, durationMs);
  const res = formatResolution(width, height);
  const meta = [res, formatDay(modifiedAt)].filter(Boolean).join(' · ');
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress ?? onMore}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatTime(durationMs)}${watched ? ', watched' : ''}`}
      accessibilityState={selected !== undefined ? { selected } : undefined}
      accessibilityHint={selectHint(selected, selecting)}
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
        {selected ? <View style={[styles.selectedFrame, { borderColor: theme.accent, backgroundColor: theme.accentSoft }]} /> : null}
        {selecting ? (
          <SelectCircle selected={!!selected} style={styles.selectSpot} />
        ) : onMore ? (
          <View style={styles.more}>
            <IconButton icon={{ ios: 'ellipsis', md: 'more_vert' }} label={`More options for ${title}`} onPress={onMore} size={18} color="#FFFFFF" />
          </View>
        ) : null}
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

/** Screen-reader hint for a video that can be played, or picked while selecting several. */
export function selectHint(selected: boolean | undefined, selecting: boolean | undefined): string {
  if (selecting) return selected ? 'Unselects it.' : 'Selects it.';
  return selected !== undefined ? 'Plays the video. Long-press to select several.' : 'Plays the video. Long-press for more options.';
}

/** Round check box for picking videos: filled with a tick when picked. [plain]: on the page, not on a thumbnail. */
export function SelectCircle({ selected, plain, size = 24, style }: { selected: boolean; plain?: boolean; size?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: selected ? theme.accent : plain ? 'transparent' : 'rgba(0,0,0,0.35)',
          borderColor: selected ? theme.accent : plain ? theme.textSecondary : '#FFFFFF',
        },
        style,
      ]}>
      {selected ? <Icon ios="checkmark" md="check" size={size * 0.7} color={theme.onAccent} /> : null}
    </View>
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
  circle: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  selectSpot: { position: 'absolute', right: 7, top: 7 },
  selectedFrame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderWidth: 3, borderRadius: Radius.thumb },
  more: { position: 'absolute', right: 4, top: 4, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  progressTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  progressFill: { height: 3 },
  title: { lineHeight: 19 },
});

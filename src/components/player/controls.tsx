import type { AndroidSymbol, SFSymbol } from 'expo-symbols';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { SeekBar } from '@/components/player/seek-bar';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/theme';
import { formatTime } from '@/lib/format';
import { formatDelay, type SmoothingMode } from '@/lib/settings-schema';

type IconName = { ios: SFSymbol; md: AndroidSymbol };

function Btn({ icon, label, onPress, size = 24, active }: { icon: IconName; label: string; onPress: () => void; size?: number; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.btn, active && styles.btnActive, pressed && { opacity: 0.6 }]}>
      <Icon ios={icon.ios} md={icon.md} size={size} color={active ? Screen.accent : Screen.text} />
    </Pressable>
  );
}

const MODE_LABEL: Record<SmoothingMode, string> = { off: 'Off', blend: 'Blend', memc: 'MEMC' };

export type ControlsProps = {
  insets: EdgeInsets;
  title: string;
  paused: boolean;
  ended: boolean;
  buffering: boolean;
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  mode: SmoothingMode;
  smoothingAvailable: boolean;
  compare: boolean;
  rate: number;
  resizeMode: 'fit' | 'fill' | 'zoom';
  seekStep: number;
  /** "24 → 120 fps", shown under the mode chip */
  rateLabel: string;
  /** Current audio and subtitle delay (ms); shown as a badge when not zero. */
  audioDelayMs: number;
  subtitleDelayMs: number;
  onBack: () => void;
  onPlayPause: () => void;
  onSeekBy: (ms: number) => void;
  onScrub: (ms: number) => void;
  onScrubEnd: (ms: number) => void;
  onCycleMode: () => void;
  onToggleCompare: () => void;
  onOpenSmoothing: () => void;
  onOpenTracks: () => void;
  onOpenSpeed: () => void;
  onCycleResize: () => void;
  /** Android: turn the picture sideways. */
  onRotate?: () => void;
  /** Web: browser full screen. */
  onFullscreen?: () => void;
  onLock: () => void;
  /** Android: picture-in-picture. */
  onPip?: () => void;
};

/** "Audio +150 ms · Subs −1 s" when a delay is set; tap to adjust. */
function DelayBadge({ audioMs, subtitleMs, onPress }: { audioMs: number; subtitleMs: number; onPress: () => void }) {
  const parts = [audioMs ? `Audio ${formatDelay(audioMs)}` : '', subtitleMs ? `Subs ${formatDelay(subtitleMs)}` : ''].filter(Boolean);
  if (!parts.length) return <View style={{ flex: 1 }} />;
  return (
    <View style={{ flex: 1, alignItems: 'flex-start' }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Delay: ${parts.join(', ')}. Opens audio and subtitles.`}
        style={({ pressed }) => [styles.delay, pressed && { opacity: 0.7 }]}>
        <Icon ios="timer" md="av_timer" size={15} color={Screen.accent} />
        <ThemedText font="mono" color={Screen.text} style={{ fontSize: 12 }} numberOfLines={1}>
          {parts.join(' · ')}
        </ThemedText>
      </Pressable>
    </View>
  );
}

export function PlayerControls(p: ControlsProps) {
  const pad = { paddingLeft: p.insets.left + 8, paddingRight: p.insets.right + 8 };
  const resizeIcon: IconName =
    p.resizeMode === 'fit' ? { ios: 'arrow.up.left.and.arrow.down.right', md: 'fit_screen' } : p.resizeMode === 'zoom' ? { ios: 'crop', md: 'crop' } : { ios: 'rectangle.expand.vertical', md: 'aspect_ratio' };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={[styles.top, pad, { paddingTop: p.insets.top + 6 }]}>
        <Btn icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={p.onBack} />
        <ThemedText type="smallBold" color={Screen.text} numberOfLines={1} style={styles.title}>
          {p.title}
        </ThemedText>
        <Pressable
          onPress={p.onCycleMode}
          onLongPress={p.onOpenSmoothing}
          disabled={!p.smoothingAvailable}
          accessibilityRole="button"
          accessibilityLabel={`Motion smoothing: ${MODE_LABEL[p.mode]}`}
          accessibilityHint="Switches between off, blend and MEMC. Long-press for smoothing settings."
          style={({ pressed }) => [styles.chip, p.mode !== 'off' && p.smoothingAvailable && styles.chipOn, pressed && { opacity: 0.7 }]}>
          <ThemedText type="label" color={p.mode !== 'off' && p.smoothingAvailable ? Screen.onAccent : Screen.text} style={{ fontSize: 13 }}>
            {p.smoothingAvailable ? MODE_LABEL[p.mode] : 'Normal'}
          </ThemedText>
          {p.rateLabel ? (
            <ThemedText font="mono" color={p.mode !== 'off' && p.smoothingAvailable ? Screen.onAccent : Screen.textDim} style={{ fontSize: 11 }}>
              {p.rateLabel}
            </ThemedText>
          ) : null}
        </Pressable>
        <Btn icon={{ ios: 'rectangle.split.2x1', md: 'compare' }} label="Split compare" onPress={p.onToggleCompare} active={p.compare} />
        <Btn icon={{ ios: 'captions.bubble', md: 'subtitles' }} label="Audio and subtitles" onPress={p.onOpenTracks} />
        <Btn icon={{ ios: 'slider.horizontal.3', md: 'tune' }} label="Smoothing settings" onPress={p.onOpenSmoothing} />
      </View>

      <View style={styles.center} pointerEvents="box-none">
        <Btn icon={{ ios: 'gobackward', md: 'replay' }} label={`Back ${p.seekStep} seconds`} onPress={() => p.onSeekBy(-p.seekStep * 1000)} size={34} />
        <Pressable onPress={p.onPlayPause} accessibilityRole="button" accessibilityLabel={p.paused || p.ended ? 'Play' : 'Pause'} style={({ pressed }) => [styles.play, pressed && { opacity: 0.7 }]}>
          {p.buffering && !p.paused ? (
            <ActivityIndicator color={Screen.text} size="large" />
          ) : (
            <Icon
              ios={p.ended ? 'arrow.counterclockwise' : p.paused ? 'play.fill' : 'pause.fill'}
              md={p.ended ? 'replay' : p.paused ? 'play_arrow' : 'pause'}
              size={46}
              color={Screen.text}
            />
          )}
        </Pressable>
        <Btn icon={{ ios: 'goforward', md: 'forward_media' }} label={`Forward ${p.seekStep} seconds`} onPress={() => p.onSeekBy(p.seekStep * 1000)} size={34} />
      </View>

      <View style={[styles.bottom, pad, { paddingBottom: p.insets.bottom + 6 }]}>
        <View style={styles.row}>
          <ThemedText font="mono" color={Screen.text} style={styles.time}>
            {formatTime(p.positionMs)}
            <ThemedText font="mono" color={Screen.textDim} style={styles.time}>
              {' / '}
              {formatTime(p.durationMs)}
            </ThemedText>
          </ThemedText>
          <DelayBadge audioMs={p.audioDelayMs} subtitleMs={p.subtitleDelayMs} onPress={p.onOpenTracks} />
          <View style={styles.rowRight}>
            <Pressable onPress={p.onOpenSpeed} accessibilityRole="button" accessibilityLabel={`Speed ${p.rate}×`} style={styles.speed}>
              <ThemedText font="mono" color={p.rate !== 1 ? Screen.accent : Screen.text} style={{ fontSize: 13 }}>
                {p.rate}×
              </ThemedText>
            </Pressable>
            <Btn icon={resizeIcon} label={`Picture size: ${p.resizeMode}`} onPress={p.onCycleResize} />
            {p.onRotate ? <Btn icon={{ ios: 'rotate.right', md: 'screen_rotation' }} label="Rotate" onPress={p.onRotate} /> : null}
            {p.onPip ? <Btn icon={{ ios: 'pip.enter', md: 'picture_in_picture_alt' }} label="Picture-in-picture" onPress={p.onPip} /> : null}
            {p.onFullscreen ? (
              <Btn icon={{ ios: 'arrow.up.left.and.arrow.down.right', md: 'fullscreen' }} label="Full screen" onPress={p.onFullscreen} />
            ) : (
              <Btn icon={{ ios: 'lock.open', md: 'lock_open' }} label="Lock controls" onPress={p.onLock} />
            )}
          </View>
        </View>
        <SeekBar positionMs={p.positionMs} durationMs={p.durationMs} bufferedMs={p.bufferedMs} onScrub={p.onScrub} onScrubEnd={p.onScrubEnd} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 18, backgroundColor: Screen.scrimSoft },
  title: { flex: 1, fontSize: 15 },
  chip: { borderWidth: 1, borderColor: Screen.track, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 3, alignItems: 'center', minWidth: 74, marginHorizontal: 4 },
  chipOn: { backgroundColor: Screen.accent, borderColor: Screen.accent },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 44 },
  play: { width: 76, height: 76, borderRadius: 38, backgroundColor: Screen.scrim, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 18, backgroundColor: Screen.scrimSoft },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  time: { fontSize: 13 },
  delay: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: Screen.track, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6 },
  speed: { paddingHorizontal: 10, paddingVertical: 8 },
  btn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  btnActive: { backgroundColor: 'rgba(240,162,74,0.18)' },
});

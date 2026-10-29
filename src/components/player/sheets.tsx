import { StyleSheet, Switch, View } from 'react-native';

import { Segmented } from '@/components/segmented';
import { Sheet, SheetOption } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatFps } from '@/lib/format';
import type { AnalysisQuality, SmoothingMode } from '@/lib/settings-schema';
import type { Track, TracksEvent } from 'glide-engine';

function ToggleRow({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <ThemedText>{label}</ThemedText>
        {detail ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.backgroundSelected }} thumbColor={theme.surface} accessibilityLabel={label} />
    </View>
  );
}

export function SmoothingSheet(p: {
  visible: boolean;
  onClose: () => void;
  available: boolean;
  mode: SmoothingMode;
  onMode: (m: SmoothingMode) => void;
  compare: boolean;
  onCompare: (v: boolean) => void;
  vectors: boolean;
  onVectors: (v: boolean) => void;
  targetFps: number;
  onTargetFps: (v: number) => void;
  refreshRates: number[];
  quality: AnalysisQuality;
  onQuality: (q: AnalysisQuality) => void;
  sourceFps: number;
}) {
  const maxHz = Math.max(60, ...p.refreshRates);
  const fpsOptions = [0, ...[60, 90, 120, 144].filter((r) => r <= maxHz + 1)].map((v) => ({ value: v, label: v === 0 ? `Auto` : String(v) }));
  return (
    <Sheet visible={p.visible} title="Motion smoothing" onClose={p.onClose}>
      {!p.available ? (
        <ThemedText themeColor="textSecondary">This video plays without smoothing (its format can’t go through the GPU effect).</ThemedText>
      ) : null}
      <Segmented
        options={[
          { value: 'off', label: 'Off' },
          { value: 'blend', label: 'Blend' },
          { value: 'memc', label: 'MEMC' },
        ]}
        value={p.mode}
        onChange={p.onMode}
      />
      <ThemedText type="caption" themeColor="textSecondary">
        {p.mode === 'memc'
          ? 'Estimates motion and builds new frames between the real ones.'
          : p.mode === 'blend'
            ? 'Cross-fades between frames. Cheaper, but moving edges ghost.'
            : 'Shows each frame as recorded.'}
        {p.sourceFps > 0 ? ` This video: ${formatFps(p.sourceFps)} fps.` : ''}
      </ThemedText>

      <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
        Frame rate
      </ThemedText>
      <Segmented options={fpsOptions} value={fpsOptions.some((o) => o.value === p.targetFps) ? p.targetFps : 0} onChange={p.onTargetFps} dense />
      <ThemedText type="caption" themeColor="textSecondary">
        Auto uses your screen’s fastest refresh rate ({Math.round(maxHz)} Hz).
      </ThemedText>

      <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
        Analysis
      </ThemedText>
      <Segmented
        options={[
          { value: 'fast', label: 'Fast' },
          { value: 'balanced', label: 'Balanced' },
          { value: 'detailed', label: 'Detailed' },
        ]}
        value={p.quality}
        onChange={p.onQuality}
        dense
      />

      <ToggleRow label="Split compare" detail="Left: original. Right: smoothed. Drag the line." value={p.compare} onChange={p.onCompare} />
      <ToggleRow label="Show motion vectors" detail="Colour is direction, strength is speed." value={p.vectors} onChange={p.onVectors} />
    </Sheet>
  );
}

export function TracksSheet(p: {
  visible: boolean;
  onClose: () => void;
  tracks: TracksEvent;
  onAudio: (t: Track | null) => void;
  onText: (t: Track | null) => void;
  onLoadSubtitles: () => void;
}) {
  const textOn = p.tracks.text.some((t) => t.selected);
  return (
    <Sheet visible={p.visible} title="Audio & subtitles" onClose={p.onClose}>
      <ThemedText type="label" themeColor="textSecondary">
        Audio
      </ThemedText>
      {p.tracks.audio.length ? (
        p.tracks.audio.map((t) => <SheetOption key={t.id} label={t.label} selected={t.selected} onPress={() => p.onAudio(t)} />)
      ) : (
        <ThemedText themeColor="textSecondary">No audio tracks.</ThemedText>
      )}
      <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
        Subtitles
      </ThemedText>
      <SheetOption label="Off" selected={!textOn} onPress={() => p.onText(null)} />
      {p.tracks.text.map((t) => (
        <SheetOption key={t.id} label={t.label} selected={t.selected} onPress={() => p.onText(t)} />
      ))}
      <SheetOption label="Load a subtitle file…" detail=".srt, .vtt, .ass" onPress={p.onLoadSubtitles} />
    </Sheet>
  );
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function SpeedSheet({ visible, onClose, rate, onRate }: { visible: boolean; onClose: () => void; rate: number; onRate: (r: number) => void }) {
  return (
    <Sheet visible={visible} title="Speed" onClose={onClose}>
      {SPEEDS.map((s) => (
        <SheetOption
          key={s}
          label={`${s}×`}
          detail={s < 1 ? 'Smoothing fills in the extra frames: smooth slow motion' : undefined}
          selected={s === rate}
          onPress={() => onRate(s)}
        />
      ))}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: Spacing.two },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one, marginTop: Spacing.one },
});

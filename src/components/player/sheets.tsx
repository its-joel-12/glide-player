import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { DelayRow } from '@/components/delay-row';
import { Segmented } from '@/components/segmented';
import { Sheet, SheetOption } from '@/components/sheet';
import { SkipRuleEditor } from '@/components/skip-rule-editor';
import { ThemedText } from '@/components/themed-text';
import { SubtitleStyleEditor } from '@/components/subtitle-style-editor';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatFps, formatResolution } from '@/lib/format';
import { addSkipRule, useSkipRules } from '@/lib/skip-buttons';
import { findRule, seriesFromTitle } from '@/lib/skip-rules';
import { AUDIO_DELAY_RANGE, formatDelay, SharpnessOptions, SUBTITLE_DELAY_RANGE, type AnalysisQuality, type SmoothingMode, type SubtitleStyle } from '@/lib/settings-schema';
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
  showStats: boolean;
  onShowStats: (v: boolean) => void;
  upscale: boolean;
  onUpscale: (v: boolean) => void;
  sharpness: number;
  onSharpness: (v: number) => void;
  /** Size of the video, for the upscaling note (0 = unknown). */
  videoWidth: number;
  videoHeight: number;
}) {
  const res = formatResolution(p.videoWidth, p.videoHeight);
  const maxHz = Math.max(60, ...p.refreshRates);
  const fpsOptions = [0, ...[60, 90, 120, 144].filter((r) => r <= maxHz + 1)].map((v) => ({ value: v, label: v === 0 ? `Auto` : String(v) }));
  return (
    <Sheet visible={p.visible} title="Picture" onClose={p.onClose}>
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

      <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
        Upscaling
      </ThemedText>
      <ToggleRow
        label="Sharper low-resolution video"
        detail={`Resamples small or pixelated videos to your screen’s size along their edges, then sharpens them.${res ? ` This video: ${res}.` : ''}`}
        value={p.upscale}
        onChange={p.onUpscale}
      />
      {p.upscale ? (
        <Segmented options={SharpnessOptions.map((o) => ({ value: o.value as number, label: o.label }))} value={p.sharpness} onChange={p.onSharpness} dense />
      ) : null}

      <ToggleRow label="Show frame rates" detail="Video fps, frames reaching the screen, made-up and dropped frames." value={p.showStats} onChange={p.onShowStats} />
      <ToggleRow label="Split compare" detail="Left: original. Right: smoothed and/or upscaled. Drag the line." value={p.compare} onChange={p.onCompare} />
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
  audioDelayMs: number;
  onAudioDelay: (ms: number) => void;
  subtitleDelayMs: number;
  onSubtitleDelay: (ms: number) => void;
  onSubtitleStyle: () => void;
  minAudioDelayMs?: number;
  /** The defaults from Settings (where tapping a value goes back to). */
  defaultAudioDelayMs: number;
  defaultSubtitleDelayMs: number;
  /** Saves the current delays as the defaults for every video. */
  onSaveDefaultDelays: () => void;
}) {
  const textOn = p.tracks.text.some((t) => t.selected);
  const differs = p.audioDelayMs !== p.defaultAudioDelayMs || p.subtitleDelayMs !== p.defaultSubtitleDelayMs;
  const defaultsNote = `Current default: audio ${formatDelay(p.defaultAudioDelayMs)}, subtitles ${formatDelay(p.defaultSubtitleDelayMs)}.`;
  return (
    <Sheet visible={p.visible} title="Audio & subtitles" onClose={p.onClose}>
      <ThemedText type="label" themeColor="textSecondary">
        Audio
      </ThemedText>
      {p.tracks.audio.length ? (
        p.tracks.audio.map((t) => <SheetOption key={t.id} label={t.label} detail={t.unsupported} selected={t.selected} onPress={() => !t.unsupported && p.onAudio(t)} />)
      ) : (
        <ThemedText themeColor="textSecondary">No audio tracks.</ThemedText>
      )}
      <DelayRow
        label="Audio delay"
        detail="Plus: sound comes later. Minus: sound comes earlier. Tap the number to go back to your default."
        value={p.audioDelayMs}
        big={500}
        min={p.minAudioDelayMs ?? AUDIO_DELAY_RANGE.min}
        max={AUDIO_DELAY_RANGE.max}
        resetTo={p.defaultAudioDelayMs}
        onChange={p.onAudioDelay}
      />
      <ThemedText type="label" themeColor="textSecondary" style={styles.label}>
        Subtitles
      </ThemedText>
      <SheetOption label="Off" selected={!textOn} onPress={() => p.onText(null)} />
      {p.tracks.text.map((t) => (
        <SheetOption key={t.id} label={t.label} selected={t.selected} onPress={() => p.onText(t)} />
      ))}
      <SheetOption label="Load a subtitle file…" detail=".srt, .vtt, .ass" onPress={p.onLoadSubtitles} />
      <DelayRow
        label="Subtitle delay"
        detail="Plus: subtitles appear later. Minus: earlier."
        value={p.subtitleDelayMs}
        big={1000}
        min={SUBTITLE_DELAY_RANGE.min}
        max={SUBTITLE_DELAY_RANGE.max}
        resetTo={p.defaultSubtitleDelayMs}
        onChange={p.onSubtitleDelay}
      />
      {differs ? (
        <SheetOption label="Use these delays for all videos" detail={defaultsNote} onPress={p.onSaveDefaultDelays} />
      ) : (
        <ThemedText type="caption" themeColor="textSecondary">
          {defaultsNote} Change them here or in Settings.
        </ThemedText>
      )}
      <SheetOption label="Subtitle style…" detail="Size, font, colour, background, outline, position" onPress={p.onSubtitleStyle} />
    </Sheet>
  );
}

export function SubtitleStyleSheet({ visible, onClose, value, onChange }: { visible: boolean; onClose: () => void; value: SubtitleStyle; onChange: (s: SubtitleStyle) => void }) {
  return (
    <Sheet visible={visible} title="Subtitle style" onClose={onClose}>
      <SubtitleStyleEditor value={value} onChange={onChange} />
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

/** Skip buttons for the playing video's series: add them, or change the matched series' buttons. */
export function SkipSheet({ visible, onClose, title }: { visible: boolean; onClose: () => void; title: string }) {
  const rules = useSkipRules();
  // Keep editing the same series even while its name is changed so it no longer matches this video.
  const [editingId, setEditingId] = useState<string | null>(null);
  const rule = rules.find((r) => r.id === editingId) ?? findRule(title, rules);
  const suggested = seriesFromTitle(title);
  return (
    <Sheet
      visible={visible}
      title="Skip buttons"
      onClose={() => {
        setEditingId(null);
        onClose();
      }}>
      {rule ? (
        <SkipRuleEditor key={rule.id} rule={rule} title={title} onDeleted={() => setEditingId(null)} />
      ) : (
        <>
          <ThemedText themeColor="textSecondary">
            Add a button that jumps ahead a set number of seconds (like past an opening song). It shows whenever you tap the screen on any episode of this series.
          </ThemedText>
          <SheetOption label={`Add for “${suggested}”`} detail="Starts with “Skip intro +90s”; you can change the name, label and seconds." onPress={() => setEditingId(addSkipRule(suggested).id)} />
        </>
      )}
      <ThemedText type="caption" themeColor="textSecondary">
        All series are listed in Settings → Skip buttons.
      </ThemedText>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: Spacing.two },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one, marginTop: Spacing.one },
});

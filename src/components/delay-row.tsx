import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DELAY_STEP_MS, formatDelay } from '@/lib/settings-schema';

type Props = {
  label: string;
  detail?: string;
  value: number;
  /** Size of the outer buttons (ms); the inner ones move by DELAY_STEP_MS. */
  big: number;
  min: number;
  max: number;
  /** What tapping the number goes back to (default 0). */
  resetTo?: number;
  onChange: (ms: number) => void;
};

/** VLC-style delay stepper: − big, − small, value (tap to reset), + small, + big. Used in the player and in Settings. */
export function DelayRow({ label, detail, value, big, min, max, resetTo = 0, onChange }: Props) {
  const theme = useTheme();
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  const btn = (d: number) => (
    <Pressable
      key={d}
      onPress={() => step(d)}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${d > 0 ? 'plus' : 'minus'} ${formatDelay(Math.abs(d)).slice(1)}`}
      style={({ pressed }) => [styles.step, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
      <ThemedText type="smallBold">{(d > 0 ? '+' : '−') + formatDelay(Math.abs(d)).slice(1)}</ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: Spacing.one, marginTop: Spacing.one }}>
      <ThemedText>{label}</ThemedText>
      <View style={styles.delayRow}>
        {btn(-big)}
        {btn(-DELAY_STEP_MS)}
        <Pressable onPress={() => onChange(resetTo)} accessibilityRole="button" accessibilityLabel={`${label} ${formatDelay(value)}, tap to reset`} style={styles.delayValue}>
          <ThemedText type="smallBold" font="mono" style={{ color: value === 0 ? theme.textSecondary : theme.accentText }}>
            {formatDelay(value)}
          </ThemedText>
        </Pressable>
        {btn(DELAY_STEP_MS)}
        {btn(big)}
      </View>
      {detail ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  delayRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  delayValue: { flex: 1, alignItems: 'center', paddingVertical: Spacing.two },
  step: { paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderRadius: Radius.button, minWidth: 56, alignItems: 'center' },
});

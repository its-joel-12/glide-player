import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Option<T extends string | number> = { value: T; label: string; disabled?: boolean };
type Props<T extends string | number> = { options: Option<T>[]; value: T; onChange: (value: T) => void; dense?: boolean };

/** One-of-several picker in a single bordered strip. */
export function Segmented<T extends string | number>({ options, value, onChange, dense }: Props<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.wrap, { borderColor: theme.border, backgroundColor: theme.background }]} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => !o.disabled && onChange(o.value)}
            disabled={o.disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on, disabled: o.disabled }}
            style={({ pressed }) => [
              styles.option,
              dense && styles.dense,
              on && { backgroundColor: theme.accent },
              pressed && !on && { backgroundColor: theme.backgroundElement },
              o.disabled && { opacity: 0.4 },
            ]}>
            <ThemedText type="label" style={{ fontSize: dense ? 13 : 14, color: on ? theme.onAccent : theme.textSecondary }}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 3, padding: 3, borderWidth: 1, borderRadius: Radius.button },
  option: {
    flexGrow: 1,
    flexShrink: 0,
    flexBasis: 'auto',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button - 3,
    paddingHorizontal: 10,
  },
  dense: { minHeight: 34, paddingHorizontal: 8 },
});

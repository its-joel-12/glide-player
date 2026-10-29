import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AndroidSymbol, SFSymbol } from 'expo-symbols';

type Props = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  icon?: { ios: SFSymbol; md: AndroidSymbol };
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = 'primary', icon, busy, disabled, style }: Props) {
  const theme = useTheme();
  const bg = variant === 'primary' ? theme.accent : variant === 'secondary' ? theme.backgroundElement : 'transparent';
  const fg = variant === 'primary' ? theme.onAccent : variant === 'secondary' ? theme.text : theme.accentText;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      style={({ pressed }) => [styles.base, { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }, style]}>
      <View style={styles.row}>
        {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon ios={icon.ios} md={icon.md} size={20} color={fg} /> : null}
        <ThemedText type="label" style={{ color: fg, fontSize: 15 }}>
          {label}
        </ThemedText>
      </View>
    </Pressable>
  );
}

/** Round icon-only button (headers, player controls). */
export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
  style,
  active,
}: {
  icon: { ios: SFSymbol; md: AndroidSymbol };
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  active?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [styles.icon, active && { backgroundColor: theme.accentSoft }, pressed && { opacity: 0.6 }, style]}>
      <Icon ios={icon.ios} md={icon.md} size={size} color={color ?? theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 46, borderRadius: Radius.button, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});

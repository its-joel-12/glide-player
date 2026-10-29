import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = { visible: boolean; title?: string; onClose: () => void; children: ReactNode };

/** A panel that slides up from the bottom; tap outside to close. */
export function Sheet({ visible, title, onClose, children }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={[
          styles.panel,
          { backgroundColor: theme.surface, paddingBottom: insets.bottom + Spacing.three, paddingLeft: insets.left + Spacing.three, paddingRight: insets.right + Spacing.three },
        ]}>
        <View style={[styles.grabber, { backgroundColor: theme.faint }]} />
        {title ? (
          <ThemedText type="subtitle" style={styles.title}>
            {title}
          </ThemedText>
        ) : null}
        <ScrollView bounces={false} contentContainerStyle={{ gap: Spacing.two }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A tappable row inside a sheet, with an optional tick. */
export function SheetOption({ label, detail, selected, onPress }: { label: string; detail?: string; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.option, { backgroundColor: selected ? theme.accentSoft : pressed ? theme.backgroundElement : 'transparent' }]}>
      <View style={{ flex: 1 }}>
        <ThemedText style={{ fontWeight: selected ? 600 : 400 }}>{label}</ThemedText>
        {detail ? (
          <ThemedText type="caption" themeColor="textSecondary">
            {detail}
          </ThemedText>
        ) : null}
      </View>
      {selected ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  panel: { maxHeight: '75%', borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet, paddingTop: Spacing.two },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: Spacing.two },
  title: { marginBottom: Spacing.two },
  option: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12, borderRadius: Radius.button, gap: 12 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});

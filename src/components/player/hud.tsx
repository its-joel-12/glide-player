import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/constants/theme';

export type Hud =
  | { kind: 'brightness'; value: number }
  | { kind: 'volume'; value: number }
  | { kind: 'seek'; label: string; detail: string }
  | { kind: 'text'; label: string };

/** The feedback pill in the middle of the picture while swiping or double-tapping. */
export function HudPill({ hud }: { hud: Hud | null }) {
  if (!hud) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.pill}>
        {hud.kind === 'brightness' || hud.kind === 'volume' ? (
          <>
            <Icon
              ios={hud.kind === 'brightness' ? 'sun.max.fill' : hud.value === 0 ? 'speaker.slash.fill' : 'speaker.wave.2.fill'}
              md={hud.kind === 'brightness' ? 'brightness_6' : hud.value === 0 ? 'volume_off' : 'volume_up'}
              size={22}
              color={Screen.text}
            />
            <View style={styles.level}>
              <View style={[styles.levelFill, { width: `${Math.round(hud.value * 100)}%` }]} />
            </View>
            <ThemedText font="mono" color={Screen.text} style={styles.num}>
              {Math.round(hud.value * 100)}
            </ThemedText>
          </>
        ) : hud.kind === 'seek' ? (
          <View style={{ alignItems: 'center' }}>
            <ThemedText type="subtitle" color={Screen.text}>
              {hud.label}
            </ThemedText>
            <ThemedText font="mono" color={Screen.textDim} style={styles.num}>
              {hud.detail}
            </ThemedText>
          </View>
        ) : (
          <ThemedText type="label" color={Screen.text} style={{ fontSize: 15 }}>
            {hud.label}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: Screen.scrim },
  level: { width: 140, height: 4, borderRadius: 2, backgroundColor: Screen.track, overflow: 'hidden' },
  levelFill: { height: 4, backgroundColor: Screen.accent },
  num: { fontSize: 13, minWidth: 28, textAlign: 'right' },
});

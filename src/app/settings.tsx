import Constants from 'expo-constants';
import { router } from 'expo-router';
import { getDisplayInfo } from 'glide-engine';
import { useMemo, type ReactNode } from 'react';
import { Platform, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/button';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setPreference, usePreferences } from '@/lib/preferences';
import { SeekStepOptions } from '@/lib/settings-schema';

const isWeb = Platform.OS === 'web';

function Group({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.two }}>
      <ThemedText type="label" themeColor="textSecondary">
        {title}
      </ThemedText>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
    </View>
  );
}

function Toggle({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
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

function Field({ label, detail, children }: { label: string; detail?: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <ThemedText>{label}</ThemedText>
      {children}
      {detail ? (
        <ThemedText type="caption" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
    </View>
  );
}

export default function SettingsScreen() {
  const prefs = usePreferences();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const display = useMemo(() => getDisplayInfo(), []);
  const maxHz = Math.round(display.maxRefreshRate);
  const fpsOptions = [0, ...[60, 90, 120, 144].filter((r) => r <= maxHz + 1)].map((v) => ({ value: v, label: v === 0 ? 'Auto' : String(v) }));
  const rates = display.refreshRates.map((r) => Math.round(r)).join(', ');

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <IconButton icon={{ ios: 'chevron.left', md: 'arrow_back' }} label="Back" onPress={() => router.back()} />
        <ThemedText type="subtitle" accessibilityRole="header">
          Settings
        </ThemedText>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <Group title="Motion smoothing">
          <Field label="Start videos with" detail="You can switch any time from the chip at the top of the player.">
            <Segmented
              options={[
                { value: 'off', label: 'Off' },
                { value: 'blend', label: 'Blend' },
                { value: 'memc', label: 'MEMC' },
              ]}
              value={prefs.mode}
              onChange={(v) => setPreference('mode', v)}
            />
          </Field>
          <Field label="Frame rate" detail={
              isWeb
                ? `Auto matches this screen’s refresh rate (${maxHz} Hz, measured by the browser).`
                : `Auto matches your screen’s fastest refresh rate (${maxHz} Hz; this screen offers ${rates} Hz). If videos look capped at 60, set the phone’s screen refresh rate to High.`
            }>
            <Segmented options={fpsOptions} value={fpsOptions.some((o) => o.value === prefs.targetFps) ? prefs.targetFps : 0} onChange={(v) => setPreference('targetFps', v)} dense />
          </Field>
          <Field label="Analysis" detail="Detailed follows small, fast motion better but uses more battery.">
            <Segmented
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'detailed', label: 'Detailed' },
              ]}
              value={prefs.quality}
              onChange={(v) => setPreference('quality', v)}
              dense
            />
          </Field>
          <Toggle label="Show frame rate on the player" detail="Source fps → screen fps, and made-up frames per second." value={prefs.showStats} onChange={(v) => setPreference('showStats', v)} />
        </Group>

        <Group title="Playback">
          <Toggle label="Continue where I left off" value={prefs.resume} onChange={(v) => setPreference('resume', v)} />
          {isWeb ? null : (
            <>
              <Toggle label="Turn sideways for wide videos" value={prefs.autoRotate} onChange={(v) => setPreference('autoRotate', v)} />
              <Toggle label="Picture-in-picture" detail="Keeps the video in a small window when you leave the app." value={prefs.pip} onChange={(v) => setPreference('pip', v)} />
              <Toggle
                label="Play sound in the background"
                detail="When picture-in-picture is off, keeps the sound going with lock-screen controls."
                value={prefs.backgroundAudio}
                onChange={(v) => setPreference('backgroundAudio', v)}
              />
            </>
          )}
          <Field label="Double-tap to skip">
            <Segmented options={SeekStepOptions.map((s) => ({ value: s, label: `${s} s` }))} value={prefs.seekStep} onChange={(v) => setPreference('seekStep', v)} dense />
          </Field>
        </Group>

        <Group title="Appearance">
          <Field label="Theme">
            <Segmented
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={prefs.theme}
              onChange={(v) => setPreference('theme', v)}
              dense
            />
          </Field>
        </Group>

        <Group title="About">
          <View style={styles.field}>
            <ThemedText>Glide {Constants.expoConfig?.version ?? ''}</ThemedText>
            <ThemedText type="caption" themeColor="textSecondary">
              MEMC (motion estimation, motion compensation) finds how each block of the picture moves between two frames and draws new
              frames along those paths. Netflix, Prime Video and YouTube protect their streams, so Glide plays your own video files.
              {isWeb ? ' Keys: Space play/pause · ←/→ seek · ↑/↓ volume · M smoothing mode · C split compare · V motion vectors · F full screen.' : ''}
            </ThemedText>
          </View>
        </Group>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two },
  content: { paddingHorizontal: Spacing.three, gap: Spacing.four, width: '100%', maxWidth: 640, alignSelf: 'center' },
  group: { borderWidth: 1, borderRadius: Radius.card, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: Spacing.two },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.one },
  field: { gap: Spacing.two, paddingVertical: Spacing.one },
});

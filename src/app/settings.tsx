import Constants from 'expo-constants';
import { router } from 'expo-router';
import { getDisplayInfo } from 'glide-engine';
import { useMemo, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/button';
import { DelayRow } from '@/components/delay-row';
import { Icon } from '@/components/icon';
import { Segmented } from '@/components/segmented';
import { SkipRuleEditor } from '@/components/skip-rule-editor';
import { SubtitleStyleEditor } from '@/components/subtitle-style-editor';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { setPreference, usePreferences } from '@/lib/preferences';
import { addSkipRule, useSkipRules } from '@/lib/skip-buttons';
import { skipButtonText } from '@/lib/skip-rules';
import { AUDIO_DELAY_RANGE, HoldSpeedOptions, SeekStepOptions, SharpnessOptions, SUBTITLE_DELAY_RANGE, WEB_MIN_AUDIO_DELAY_MS } from '@/lib/settings-schema';

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

/** Every series with skip buttons; tap one to change it. */
function SkipRules() {
  const theme = useTheme();
  const rules = useSkipRules();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <ThemedText type="caption" themeColor="textSecondary">
        Buttons that jump ahead a set number of seconds (past an opening or ending song). They show when you tap the screen on a video whose file
        name contains all the words of the series name. You can also add them from the player (the skip icon at the top).
      </ThemedText>
      {rules.map((r) =>
        open === r.id ? (
          <View key={r.id} style={[styles.skipOpen, { borderColor: theme.border }]}>
            <SkipRuleEditor rule={r} onDeleted={() => setOpen(null)} />
            <Pressable onPress={() => setOpen(null)} accessibilityRole="button" style={styles.done}>
              <ThemedText type="smallBold" themeColor="accentText">
                Done
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <Pressable
            key={r.id}
            onPress={() => setOpen(r.id)}
            accessibilityRole="button"
            accessibilityHint="Opens this series' skip buttons"
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <ThemedText>{r.match.trim() || 'No series name yet'}</ThemedText>
              <ThemedText type="caption" themeColor="textSecondary">
                {r.buttons.length ? r.buttons.map(skipButtonText).join(' · ') : 'No buttons'}
              </ThemedText>
            </View>
            <Icon ios="chevron.right" md="chevron_right" size={20} color={theme.textSecondary} />
          </Pressable>
        ),
      )}
      <Pressable onPress={() => setOpen(addSkipRule('').id)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
        <Icon ios="plus" md="add" size={20} color={theme.accentText} />
        <ThemedText themeColor="accentText">Add a series</ThemedText>
      </Pressable>
    </>
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
          <Toggle label="Show frame rate on the player" detail="Video fps, frames reaching the screen, made-up and dropped frames." value={prefs.showStats} onChange={(v) => setPreference('showStats', v)} />
        </Group>

        <Group title="Upscaling">
          <Toggle
            label="Sharper low-resolution video"
            detail="Videos smaller than your screen (360p, 480p, pixelated clips) are resampled to the screen’s size along their edges and sharpened, on the GPU, while they play. Toggle it in the player with the Picture button (U on a keyboard)."
            value={prefs.upscale}
            onChange={(v) => setPreference('upscale', v)}
          />
          {prefs.upscale ? (
            <Field label="Sharpening" detail="Strong brings out more detail but also more compression blocks.">
              <Segmented
                options={SharpnessOptions.map((o) => ({ value: o.value as number, label: o.label }))}
                value={prefs.sharpness}
                onChange={(v) => setPreference('sharpness', v)}
                dense
              />
            </Field>
          ) : null}
          {isWeb ? null : (
            <ThemedText type="caption" themeColor="textSecondary">
              For the sharpest result, save an AI-upscaled copy from a video’s menu (Save … copy → Sharper). It takes longer but rebuilds real detail.
            </ThemedText>
          )}
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
          {isWeb ? (
            <Toggle label="Swipe up/down for volume" detail="On phones and tablets." value={prefs.gestureVolume} onChange={(v) => setPreference('gestureVolume', v)} />
          ) : (
            <>
              <Toggle
                label="Swipe for brightness"
                detail="Up/down on the left half of the video."
                value={prefs.gestureBrightness}
                onChange={(v) => setPreference('gestureBrightness', v)}
              />
              <Toggle label="Swipe for volume" detail="Up/down on the right half of the video." value={prefs.gestureVolume} onChange={(v) => setPreference('gestureVolume', v)} />
            </>
          )}
          <Toggle
            label="Press and hold for fast playback"
            detail="Hold a finger on the video to play faster; let go for normal speed. Slide sideways while holding to change the speed."
            value={prefs.holdToSpeed}
            onChange={(v) => setPreference('holdToSpeed', v)}
          />
          {prefs.holdToSpeed ? (
            <Field label="Hold speed">
              <Segmented options={HoldSpeedOptions.map((s) => ({ value: s, label: `${s}×` }))} value={prefs.holdSpeed} onChange={(v) => setPreference('holdSpeed', v)} dense />
            </Field>
          ) : null}
          <Field label="Double-tap to skip">
            <Segmented options={SeekStepOptions.map((s) => ({ value: s, label: `${s} s` }))} value={prefs.seekStep} onChange={(v) => setPreference('seekStep', v)} dense />
          </Field>
        </Group>

        <Group title="Skip buttons">
          <SkipRules />
        </Group>

        <Group title="Audio & subtitle sync">
          <View style={styles.field}>
            <DelayRow
              label="Default audio delay"
              detail={`Every video starts with this. Plus: sound later. Minus: sound earlier.${isWeb ? ' In the browser, sound can be at most 0.5 s early.' : ''}`}
              value={prefs.audioDelayMs}
              big={500}
              min={isWeb ? WEB_MIN_AUDIO_DELAY_MS : AUDIO_DELAY_RANGE.min}
              max={AUDIO_DELAY_RANGE.max}
              onChange={(v) => setPreference('audioDelayMs', v)}
            />
            <DelayRow
              label="Default subtitle delay"
              detail="Plus: subtitles later. Minus: earlier. You can still adjust each video from the player; tap a number to reset it to 0."
              value={prefs.subtitleDelayMs}
              big={1000}
              min={SUBTITLE_DELAY_RANGE.min}
              max={SUBTITLE_DELAY_RANGE.max}
              onChange={(v) => setPreference('subtitleDelayMs', v)}
            />
          </View>
        </Group>

        <Group title="Subtitles">
          <View style={styles.field}>
            <SubtitleStyleEditor value={prefs.subtitleStyle} onChange={(s) => setPreference('subtitleStyle', s)} />
          </View>
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
              {isWeb ? ' Keys: Space play/pause · ←/→ seek · ↑/↓ volume · M smoothing mode · C split compare · V motion vectors · F full screen · I frame rates · S skip button · J/K audio delay −/+ · G/H subtitle delay −/+.' : ''}
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
  skipOpen: { borderWidth: 1, borderRadius: Radius.card, padding: Spacing.two, gap: Spacing.two },
  done: { alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 8 },
});

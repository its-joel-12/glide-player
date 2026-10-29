import { Pressable, StyleSheet, Switch, Text, View, type TextStyle } from 'react-native';

import { Button } from '@/components/button';
import { Segmented } from '@/components/segmented';
import { ThemedText } from '@/components/themed-text';
import { fontFamily, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DefaultSubtitleStyle, type SubtitleStyle } from '@/lib/settings-schema';

const SIZES = [
  { value: 0.8, label: 'S' },
  { value: 1, label: 'M' },
  { value: 1.3, label: 'L' },
  { value: 1.7, label: 'XL' },
];
const FONTS: { value: SubtitleStyle['font']; label: string }[] = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'condensed', label: 'Narrow' },
  { value: 'casual', label: 'Casual' },
];
const TEXT_COLORS = [
  { hex: '#FFFFFF', name: 'White' },
  { hex: '#FFE14D', name: 'Yellow' },
  { hex: '#5CE1E6', name: 'Cyan' },
  { hex: '#7CFC7C', name: 'Green' },
  { hex: '#FF8AD8', name: 'Pink' },
  { hex: '#FFB347', name: 'Orange' },
  { hex: '#CFCFCF', name: 'Grey' },
];
const BG_COLORS = [
  { hex: '#000000', name: 'Black' },
  { hex: '#333333', name: 'Dark grey' },
  { hex: '#0B1E3A', name: 'Navy' },
  { hex: '#FFFFFF', name: 'White' },
];
const EDGE_COLORS = [
  { hex: '#000000', name: 'Black' },
  { hex: '#333333', name: 'Dark grey' },
  { hex: '#FFFFFF', name: 'White' },
];
const POSITIONS = [
  { value: 0.03, label: 'Bottom' },
  { value: 0.08, label: 'Low' },
  { value: 0.16, label: 'Higher' },
  { value: 0.28, label: 'Middle' },
];

/** Closest preset to a stored value, so segmented controls show a selection. */
const nearest = (opts: { value: number }[], v: number) => opts.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a)).value;

const PREVIEW_FONT: Record<SubtitleStyle['font'], string> = {
  sans: fontFamily(500, 'body'),
  serif: 'serif',
  mono: 'monospace',
  condensed: fontFamily(600, 'display'),
  casual: 'casual',
};

function hexAlpha(hex: string, alpha: number) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Sample subtitle drawn with the style (an approximation of the player's rendering). */
export function SubtitlePreview({ style: s }: { style: SubtitleStyle }) {
  const bg = hexAlpha(s.backgroundColor, s.backgroundOpacity);
  const text: TextStyle = {
    fontFamily: s.font === 'sans' && s.bold ? fontFamily(600, 'body') : s.font === 'condensed' && s.bold ? fontFamily(700, 'display') : PREVIEW_FONT[s.font],
    fontWeight: s.bold && (s.font === 'serif' || s.font === 'mono' || s.font === 'casual') ? 'bold' : 'normal',
    fontSize: 17 * s.scale,
    lineHeight: 22 * s.scale,
    color: s.color,
    textAlign: 'center',
    backgroundColor: s.background === 'box' ? bg : 'transparent',
    paddingHorizontal: s.background === 'box' ? 6 : 0,
    textShadowColor: s.edge === 'none' ? 'transparent' : s.edgeColor,
    textShadowOffset: s.edge === 'shadow' || s.edge === 'raised' ? { width: 1.5, height: 1.5 } : s.edge === 'depressed' ? { width: -1.5, height: -1.5 } : { width: 0, height: 0 },
    textShadowRadius: s.edge === 'outline' ? 3 : s.edge === 'shadow' ? 3 : 0.5,
  };
  return (
    <View style={styles.preview} accessibilityLabel="Subtitle preview">
      <View style={[styles.previewSky]} />
      <View style={[styles.previewText, { bottom: `${Math.round(s.position * 100)}%`, backgroundColor: s.background === 'band' ? bg : 'transparent' }]}>
        <Text style={text}>{'The quick brown fox\njumps over the lazy dog'}</Text>
      </View>
    </View>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: { hex: string; name: string }[]; value: string; onChange: (hex: string) => void; label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {colors.map((c) => {
        const on = c.hex.toUpperCase() === value.toUpperCase();
        return (
          <Pressable
            key={c.hex}
            onPress={() => onChange(c.hex)}
            accessibilityRole="radio"
            accessibilityLabel={c.name}
            accessibilityState={{ checked: on }}
            style={[styles.swatch, { backgroundColor: c.hex, borderColor: on ? theme.accent : theme.border, borderWidth: on ? 3 : 1 }]}
          />
        );
      })}
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <ThemedText type="label" themeColor="textSecondary">
        {label}
      </ThemedText>
      {children}
    </View>
  );
}

/** All subtitle look settings, with a live preview. Used in Settings and in the player. */
export function SubtitleStyleEditor({ value, onChange }: { value: SubtitleStyle; onChange: (s: SubtitleStyle) => void }) {
  const theme = useTheme();
  const set = <K extends keyof SubtitleStyle>(k: K, v: SubtitleStyle[K]) => onChange({ ...value, [k]: v });
  return (
    <View style={{ gap: Spacing.three }}>
      <SubtitlePreview style={value} />
      <Row label="Size">
        <Segmented options={SIZES} value={nearest(SIZES, value.scale)} onChange={(v) => set('scale', v)} dense />
      </Row>
      <Row label="Font">
        <Segmented options={FONTS} value={value.font} onChange={(v) => set('font', v)} dense />
        <View style={styles.inline}>
          <ThemedText style={{ flex: 1 }}>Bold</ThemedText>
          <Switch value={value.bold} onValueChange={(v) => set('bold', v)} trackColor={{ true: theme.accent, false: theme.backgroundSelected }} thumbColor={theme.surface} accessibilityLabel="Bold" />
        </View>
      </Row>
      <Row label="Text colour">
        <Swatches colors={TEXT_COLORS} value={value.color} onChange={(v) => set('color', v)} label="Text colour" />
      </Row>
      <Row label="Background">
        <Segmented
          options={[
            { value: 'none', label: 'None' },
            { value: 'box', label: 'Box' },
            { value: 'band', label: 'Band' },
          ]}
          value={value.background}
          onChange={(v) => set('background', v)}
          dense
        />
        {value.background !== 'none' ? (
          <>
            <Swatches colors={BG_COLORS} value={value.backgroundColor} onChange={(v) => set('backgroundColor', v)} label="Background colour" />
            <Segmented
              options={[0.25, 0.5, 0.75, 1].map((o) => ({ value: o, label: `${o * 100}%` }))}
              value={nearest([0.25, 0.5, 0.75, 1].map((o) => ({ value: o })), value.backgroundOpacity)}
              onChange={(v) => set('backgroundOpacity', v)}
              dense
            />
          </>
        ) : null}
      </Row>
      <Row label="Edge">
        <Segmented
          options={[
            { value: 'none', label: 'None' },
            { value: 'outline', label: 'Outline' },
            { value: 'shadow', label: 'Shadow' },
            { value: 'raised', label: 'Raised' },
            { value: 'depressed', label: 'Sunken' },
          ]}
          value={value.edge}
          onChange={(v) => set('edge', v)}
          dense
        />
        {value.edge !== 'none' ? <Swatches colors={EDGE_COLORS} value={value.edgeColor} onChange={(v) => set('edgeColor', v)} label="Edge colour" /> : null}
      </Row>
      <Row label="Position">
        <Segmented options={POSITIONS} value={nearest(POSITIONS, value.position)} onChange={(v) => set('position', v)} dense />
      </Row>
      <View style={styles.inline}>
        <View style={{ flex: 1 }}>
          <ThemedText>Use the file’s own styles</ThemedText>
          <ThemedText type="caption" themeColor="textSecondary">
            Colours, fonts and sizes set inside .ass files and some built-in tracks.
          </ThemedText>
        </View>
        <Switch
          value={value.useFileStyles}
          onValueChange={(v) => set('useFileStyles', v)}
          trackColor={{ true: theme.accent, false: theme.backgroundSelected }}
          thumbColor={theme.surface}
          accessibilityLabel="Use the file’s own styles"
        />
      </View>
      <Button label="Reset subtitle style" variant="ghost" onPress={() => onChange(DefaultSubtitleStyle)} />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { height: 150, borderRadius: Radius.card, overflow: 'hidden', backgroundColor: '#1d2a3a' },
  previewSky: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%', backgroundColor: '#3b4a3c' },
  previewText: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingVertical: 2 },
  row: { gap: Spacing.two },
  inline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17 },
});

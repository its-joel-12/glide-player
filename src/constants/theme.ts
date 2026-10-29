/**
 * "Monitor" theme: graphite neutrals with a signal-amber accent, like a broadcast monitor.
 * Headings and labels use Barlow Condensed, text uses Barlow, numbers and timecodes JetBrains Mono.
 * Light and dark follow the phone (or the choice in Settings). The player itself is always black.
 */
import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#15191E',
    textSecondary: '#59636E',
    faint: '#AEB6BF',
    background: '#F2F4F6',
    surface: '#FFFFFF',
    backgroundElement: '#E7EAEE',
    backgroundSelected: '#DCE0E5',
    border: '#D5DAE0',
    accent: '#B8661C',
    accentText: '#9A520F',
    accentSoft: '#B8661C1F',
    onAccent: '#FFFFFF',
    danger: '#B42318',
    success: '#2E7D4F',
  },
  dark: {
    text: '#E8EBEE',
    textSecondary: '#9AA4AE',
    faint: '#4A535C',
    background: '#0E1114',
    surface: '#171B20',
    backgroundElement: '#1D2228',
    backgroundSelected: '#262C33',
    border: '#262C33',
    accent: '#F0A24A',
    accentText: '#F4B26A',
    accentSoft: '#F0A24A26',
    onAccent: '#1A1006',
    danger: '#FF8A80',
    success: '#6FCF97',
  },
} as const;

/** Colours used over video (always dark, whatever the theme). */
export const Screen = {
  black: '#000000',
  text: '#FFFFFF',
  textDim: 'rgba(255,255,255,0.72)',
  scrim: 'rgba(0,0,0,0.55)',
  scrimSoft: 'rgba(0,0,0,0.35)',
  track: 'rgba(255,255,255,0.28)',
  buffered: 'rgba(255,255,255,0.5)',
  accent: '#F0A24A',
  onAccent: '#1A1006',
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Font files loaded in app/_layout.tsx. Android can't fake weights for custom fonts, so each weight is its own family. */
export const FontFiles = {
  body: { 400: 'Barlow_400Regular', 500: 'Barlow_500Medium', 600: 'Barlow_600SemiBold' },
  display: { 500: 'BarlowCondensed_500Medium', 600: 'BarlowCondensed_600SemiBold', 700: 'BarlowCondensed_700Bold' },
  mono: { 400: 'JetBrainsMono_400Regular', 500: 'JetBrainsMono_500Medium' },
} as const;

export type FontRole = 'body' | 'display' | 'mono';

/** Picks the font file for a role and weight (rounded to the nearest one we ship). */
export function fontFamily(weight: number | string | undefined, role: FontRole = 'body'): string {
  const w = Math.round(Number(weight ?? 400) / 100) * 100;
  if (role === 'display') return FontFiles.display[w >= 700 ? 700 : w >= 600 ? 600 : 500];
  if (role === 'mono') return FontFiles.mono[w >= 500 ? 500 : 400];
  return FontFiles.body[w >= 600 ? 600 : w >= 500 ? 500 : 400];
}

export const Radius = { card: 10, chip: 6, button: 8, thumb: 6, sheet: 16 } as const;

export const Spacing = { half: 2, one: 4, two: 8, three: 16, four: 24, five: 32, six: 64 } as const;

export const MaxContentWidth = 960;

export const isAndroid = Platform.OS === 'android';

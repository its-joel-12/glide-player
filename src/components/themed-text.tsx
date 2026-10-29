import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { fontFamily, type FontRole, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?: 'default' | 'small' | 'smallBold' | 'caption' | 'title' | 'subtitle' | 'label';
  themeColor?: ThemeColor;
  /** Override the colour (e.g. white over video). */
  color?: string;
  /** Font role; titles and labels default to the condensed display face. */
  font?: FontRole;
};

const displayTypes = new Set(['title', 'subtitle', 'label']);

export function ThemedText({ style, type = 'default', themeColor, color, font, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  const flat = StyleSheet.flatten([{ color: color ?? theme[themeColor ?? 'text'] }, styles[type], style]) as TextStyle;
  // Custom fonts need the file for the weight, not fontWeight (Android would fake it).
  const { fontWeight, ...without } = flat;
  const role: FontRole = font ?? (displayTypes.has(type) ? 'display' : 'body');
  return <Text style={[without, { fontFamily: fontFamily(fontWeight, role) }]} {...rest} />;
}

const styles = StyleSheet.create({
  default: { fontSize: 16, lineHeight: 23, fontWeight: 400 },
  small: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  smallBold: { fontSize: 14, lineHeight: 20, fontWeight: 600 },
  caption: { fontSize: 12.5, lineHeight: 17, fontWeight: 500 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: 700, letterSpacing: 0.4 },
  subtitle: { fontSize: 21, lineHeight: 26, fontWeight: 600, letterSpacing: 0.3 },
  label: { fontSize: 13, lineHeight: 16, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase' },
});

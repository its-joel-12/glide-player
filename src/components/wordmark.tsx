import { Text } from 'react-native';

import { fontFamily } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** "GLIDE" with the I in the accent colour (the I is the frame being drawn in). */
export function Wordmark({ size = 30 }: { size?: number }) {
  const theme = useTheme();
  const style = { fontFamily: fontFamily(700, 'display'), fontSize: size, lineHeight: size * 1.1, letterSpacing: size * 0.14, color: theme.text };
  return (
    <Text style={style} accessibilityRole="header" accessibilityLabel="Glide">
      GL<Text style={{ color: theme.accent }}>I</Text>DE
    </Text>
  );
}

import { useColorScheme as useSystemScheme } from 'react-native';

import { usePreferences } from '@/lib/preferences';

/** The phone's light/dark setting, unless a theme was chosen in Settings. */
export function useColorScheme(): 'light' | 'dark' {
  const system = useSystemScheme();
  const { theme } = usePreferences();
  if (theme !== 'system') return theme;
  return system === 'light' ? 'light' : 'dark';
}

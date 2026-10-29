import { useEffect, useState } from 'react';
import { useColorScheme as useSystemScheme } from 'react-native';

import { usePreferences } from '@/lib/preferences';

/**
 * Web: pages are pre-rendered at build time (in light mode), so the first render in the browser
 * must match that; switch to the real scheme right after hydration.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- runs once to finish hydration
    setHydrated(true);
  }, []);
  const system = useSystemScheme();
  const { theme } = usePreferences();
  if (!hydrated) return 'light';
  if (theme !== 'system') return theme;
  return system === 'dark' ? 'dark' : 'light';
}

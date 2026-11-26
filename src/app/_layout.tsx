import { BarlowCondensed_500Medium } from '@expo-google-fonts/barlow-condensed/500Medium';
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { Barlow_400Regular } from '@expo-google-fonts/barlow/400Regular';
import { Barlow_500Medium } from '@expo-google-fonts/barlow/500Medium';
import { Barlow_600SemiBold } from '@expo-google-fonts/barlow/600SemiBold';
import { JetBrainsMono_400Regular } from '@expo-google-fonts/jetbrains-mono/400Regular';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { loadPreferences, usePreferences } from '@/lib/preferences';
import { loadResume } from '@/lib/resume';
import { loadSidecars } from '@/lib/sidecars';
import { loadSkipRules } from '@/lib/skip-buttons';
import { loadTrackMemory } from '@/lib/track-memory';
import { loadWatched } from '@/lib/watched';

void SplashScreen.preventAutoHideAsync();
void loadPreferences();
void loadResume();
void loadSidecars();
void loadTrackMemory();
void loadSkipRules();
void loadWatched();

export default function RootLayout() {
  const scheme = useColorScheme();
  const { loaded: prefsLoaded } = usePreferences();
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    BarlowCondensed_500Medium,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  const ready = (fontsLoaded || !!fontError) && prefsLoaded;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  // Keep the splash screen up until the fonts are ready (or failed: then system fonts are used).
  if (!ready) return null;

  const dark = scheme === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const c = Colors[scheme];
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: c.background, card: c.background, text: c.text, border: c.border, primary: c.accent },
  };

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.background }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.background } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="folder/[id]" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="export" />
          <Stack.Screen name="seekable" />
          <Stack.Screen
            name="player"
            options={{ presentation: 'fullScreenModal', animation: 'fade', contentStyle: { backgroundColor: '#000' } }}
          />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

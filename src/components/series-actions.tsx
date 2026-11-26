import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Sheet, SheetOption } from '@/components/sheet';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchAllVideos } from '@/lib/library';
import { groupSeries, mergedInto, seriesName, seriesTitle } from '@/lib/series';
import { mergeSeriesInto, renameSeriesTo, splitOffSeries, ungroupSeries, useSeriesOverrides } from '@/lib/series-store';

type Mode = 'menu' | 'rename' | 'merge';
type Props = {
  /** Series key; null hides the sheet. */
  seriesKey: string | null;
  onClose: () => void;
  /** After merging this series into another one (its key). */
  onMerged?: (into: string) => void;
  /** After ungrouping this series. */
  onUngrouped?: () => void;
};

/**
 * The ⋮ menu of a series: rename it, merge it into another series (when the same show has two names),
 * split off series merged into it, or ungroup it (its videos are then just videos again).
 */
export function SeriesActions({ seriesKey, onClose, onMerged, onUngrouped }: Props) {
  const theme = useTheme();
  const ov = useSeriesOverrides();
  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [others, setOthers] = useState<{ key: string; title: string; count: number }[] | null>(null);

  useEffect(() => {
    setMode('menu');
    setOthers(null);
  }, [seriesKey]);

  useEffect(() => {
    if (mode !== 'merge' || !seriesKey) return;
    let live = true;
    fetchAllVideos()
      .then((all) => {
        if (live) setOthers(groupSeries(all, ov).filter((s) => s.key !== seriesKey).map((s) => ({ key: s.key, title: s.title, count: s.items.length })));
      })
      .catch(() => live && setOthers([]));
    return () => {
      live = false;
    };
  }, [mode, seriesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!seriesKey) return null;
  const title = seriesName(seriesKey, ov);
  const renamed = !!ov.names[seriesKey];
  const parts = mergedInto(ov, seriesKey);

  const saveName = () => {
    renameSeriesTo(seriesKey, name);
    onClose();
  };

  return (
    <Sheet visible title={mode === 'rename' ? 'Rename series' : mode === 'merge' ? `Merge “${title}” into…` : title} onClose={onClose}>
      {mode === 'menu' ? (
        <>
          <SheetOption
            label="Rename"
            detail={renamed ? `From the file names: ${seriesTitle(seriesKey)}` : undefined}
            onPress={() => {
              setName(title);
              setMode('rename');
            }}
          />
          {renamed ? (
            <SheetOption
              label="Use the name from the file names"
              onPress={() => {
                renameSeriesTo(seriesKey, '');
                onClose();
              }}
            />
          ) : null}
          <SheetOption label="Merge into another series…" detail="When the same show has two names" onPress={() => setMode('merge')} />
          {parts.map((k) => (
            <SheetOption
              key={k}
              label={`Split off “${seriesName(k, ov)}”`}
              detail="Make it its own series again"
              onPress={() => {
                splitOffSeries(k);
                onClose();
              }}
            />
          ))}
          <SheetOption
            label="Ungroup"
            detail="Not a series: its videos stay in All videos and Folders"
            onPress={() => {
              ungroupSeries(seriesKey);
              onClose();
              onUngrouped?.();
            }}
          />
        </>
      ) : mode === 'rename' ? (
        <View style={{ gap: Spacing.three }}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={seriesTitle(seriesKey)}
            placeholderTextColor={theme.textSecondary}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={saveName}
            accessibilityLabel="Series name"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
          />
          <ThemedText type="caption" themeColor="textSecondary">
            Only the name shown in Glide changes; files and skip buttons stay as they are. Leave it empty to use the name from the file names.
          </ThemedText>
          <Button label="Save" onPress={saveName} />
        </View>
      ) : others === null ? (
        <ActivityIndicator color={theme.accent} style={{ marginVertical: Spacing.four }} />
      ) : others.length ? (
        others.map((s) => (
          <SheetOption
            key={s.key}
            label={s.title}
            detail={`${s.count} episodes`}
            onPress={() => {
              mergeSeriesInto(seriesKey, s.key);
              onClose();
              onMerged?.(s.key);
            }}
          />
        ))
      ) : (
        <ThemedText themeColor="textSecondary" style={{ marginVertical: Spacing.three }}>
          There are no other series to merge with.
        </ThemedText>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: Radius.button, paddingHorizontal: 12, height: 44, fontSize: 16 },
});

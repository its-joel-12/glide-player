import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { Screen } from '@/constants/theme';
import { clamp } from '@/lib/gestures';

type Props = {
  positionMs: number;
  durationMs: number;
  bufferedMs: number;
  /** While dragging: the time under the finger. */
  onScrub: (ms: number) => void;
  onScrubEnd: (ms: number) => void;
};

/** Seek bar with a big touch area: tap or drag anywhere on it. */
export function SeekBar({ positionMs, durationMs, bufferedMs, onScrub, onScrubEnd }: Props) {
  const [width, setWidth] = useState(1);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const toMs = (x: number) => clamp(x / width, 0, 1) * durationMs;

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => {
      const ms = toMs(e.x);
      setDragMs(ms);
      onScrub(ms);
    })
    .onUpdate((e) => {
      const ms = toMs(e.x);
      setDragMs(ms);
      onScrub(ms);
    })
    .onEnd((e) => onScrubEnd(toMs(e.x)))
    .onFinalize(() => setDragMs(null));

  const shown = dragMs ?? positionMs;
  const f = durationMs > 0 ? clamp(shown / durationMs, 0, 1) : 0;
  const b = durationMs > 0 ? clamp(bufferedMs / durationMs, 0, 1) : 0;
  return (
    <GestureDetector gesture={pan}>
      <View
        style={styles.touch}
        onLayout={(e: LayoutChangeEvent) => setWidth(Math.max(1, e.nativeEvent.layout.width))}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek"
        accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(shown / 1000) }}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${b * 100}%`, backgroundColor: Screen.buffered }]} />
          <View style={[styles.fill, { width: `${f * 100}%`, backgroundColor: Screen.accent }]} />
        </View>
        <View style={[styles.thumb, dragMs != null && styles.thumbActive, { left: `${f * 100}%` }]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  touch: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: Screen.track, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  thumb: { position: 'absolute', width: 14, height: 14, marginLeft: -7, borderRadius: 7, backgroundColor: Screen.accent },
  thumbActive: { width: 20, height: 20, marginLeft: -10, borderRadius: 10 },
});

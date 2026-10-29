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

/** The time under the finger for the current touch (held outside React state so the end handler sees it). */
class Scrub {
  private ms: number | null = null;
  set(ms: number) {
    this.ms = ms;
  }
  /** The pending time, cleared so it is used once. */
  take(): number | null {
    const ms = this.ms;
    this.ms = null;
    return ms;
  }
}

/**
 * Seek bar with a big touch area: tap or drag anywhere on it.
 *
 * A quick tap never "activates" a pan (that needs movement), so `onEnd` doesn't run for it.
 * The seek is therefore committed in `onFinalize`, which runs for every touch.
 */
export function SeekBar({ positionMs, durationMs, bufferedMs, onScrub, onScrubEnd }: Props) {
  const [width, setWidth] = useState(1);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const [scrub] = useState(() => new Scrub());
  const toMs = (x: number) => clamp(x / width, 0, 1) * durationMs;
  const move = (x: number) => {
    const ms = toMs(x);
    scrub.set(ms);
    setDragMs(ms);
    onScrub(ms);
  };

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .shouldCancelWhenOutside(false)
    .onBegin((e) => move(e.x))
    .onUpdate((e) => move(e.x))
    .onFinalize(() => {
      const ms = scrub.take();
      setDragMs(null);
      if (ms != null) onScrubEnd(ms);
    });

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

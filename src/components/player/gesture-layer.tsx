import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { holdSpeedFor, levelForSwipe, resizeForPinch, seekOffsetForSwipe, sideOf } from '@/lib/gestures';

type Axis = 'none' | 'seek' | 'brightness' | 'volume';

/** What the current swipe controls, decided by its first movement. */
class SwipeTracker {
  axis: Axis = 'none';
  start = 0;
  begin(axis: Axis, start = 0) {
    this.axis = axis;
    this.start = start;
  }
  end() {
    this.axis = 'none';
  }
}

type Props = {
  width: number;
  height: number;
  durationMs: number;
  resizeMode: 'fit' | 'fill' | 'zoom';
  onTap: () => void;
  onDoubleTap: (side: 'left' | 'center' | 'right') => void;
  /** Horizontal swipe: offset in ms while moving; done = finger lifted. */
  onSeekSwipe: (offsetMs: number, done: boolean) => void;
  /** Vertical swipe on the left half: returns the starting brightness. */
  getBrightness: () => number;
  onBrightness: (value: number, done: boolean) => void;
  getVolume: () => number;
  onVolume: (value: number, done: boolean) => void;
  onResize: (mode: 'fit' | 'fill' | 'zoom') => void;
  /** Vertical swipes on the left / right half (off = the swipe does nothing). */
  brightnessEnabled?: boolean;
  volumeEnabled?: boolean;
  /** Press and hold: called with the speed when the hold starts and as the finger slides, then with null on release. */
  onHoldSpeed?: (speed: number | null) => void;
  /** Speed a hold starts at (1.5, 2 or 3). */
  holdSpeed?: number;
};

/**
 * Touch handling over the video: tap shows/hides controls, double-tap left/right seeks,
 * swipe sideways to seek, swipe up/down on the left for brightness and on the right for volume,
 * pinch to fill the screen, press and hold to play faster (slide sideways to change the speed).
 */
export function GestureLayer(p: Props) {
  const [swipe] = useState(() => new SwipeTracker());

  const single = Gesture.Tap().runOnJS(true).maxDuration(250).onEnd((_e, ok) => ok && p.onTap());
  const double = Gesture.Tap()
    .runOnJS(true)
    .numberOfTaps(2)
    .maxDelay(260)
    .onEnd((e, ok) => ok && p.onDoubleTap(sideOf(e.x, p.width)));

  const pan = Gesture.Pan()
    .runOnJS(true)
    .minDistance(14)
    .onStart((e) => {
      if (Math.abs(e.translationX) > Math.abs(e.translationY)) {
        swipe.begin('seek');
      } else {
        const side = sideOf(e.x, p.width);
        if (side === 'left' && p.brightnessEnabled !== false) swipe.begin('brightness', p.getBrightness());
        else if (side === 'right' && p.volumeEnabled !== false) swipe.begin('volume', p.getVolume());
        else swipe.begin('none');
      }
    })
    .onUpdate((e) => {
      if (swipe.axis === 'seek') p.onSeekSwipe(seekOffsetForSwipe(e.translationX, p.width, p.durationMs), false);
      else if (swipe.axis === 'brightness') p.onBrightness(levelForSwipe(swipe.start, e.translationY, p.height), false);
      else if (swipe.axis === 'volume') p.onVolume(levelForSwipe(swipe.start, e.translationY, p.height), false);
    })
    .onEnd((e) => {
      if (swipe.axis === 'seek') p.onSeekSwipe(seekOffsetForSwipe(e.translationX, p.width, p.durationMs), true);
      else if (swipe.axis === 'brightness') p.onBrightness(levelForSwipe(swipe.start, e.translationY, p.height), true);
      else if (swipe.axis === 'volume') p.onVolume(levelForSwipe(swipe.start, e.translationY, p.height), true);
    })
    .onFinalize(() => swipe.end());

  // Activates only after a still half-second press; moving first fails it, so swipes win as before.
  const hold = Gesture.Pan()
    .runOnJS(true)
    .enabled(p.onHoldSpeed != null)
    .activateAfterLongPress(450)
    .minDistance(100_000)
    .failOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onStart(() => p.onHoldSpeed?.(holdSpeedFor(p.holdSpeed ?? 2, 0)))
    .onUpdate((e) => p.onHoldSpeed?.(holdSpeedFor(p.holdSpeed ?? 2, e.translationX)))
    // Runs for a lift and for a cancel alike, once the hold had started.
    .onEnd(() => p.onHoldSpeed?.(null));

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      const next = resizeForPinch(e.scale, p.resizeMode);
      if (next !== p.resizeMode) p.onResize(next);
    });

  const gesture = Gesture.Race(pinch, pan, hold, Gesture.Exclusive(double, single));
  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false} />
    </GestureDetector>
  );
}

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { levelForSwipe, resizeForPinch, seekOffsetForSwipe, sideOf } from '@/lib/gestures';

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
};

/**
 * Touch handling over the video: tap shows/hides controls, double-tap left/right seeks,
 * swipe sideways to seek, swipe up/down on the left for brightness and on the right for volume,
 * pinch to fill the screen.
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
        if (side === 'left') swipe.begin('brightness', p.getBrightness());
        else if (side === 'right') swipe.begin('volume', p.getVolume());
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

  const pinch = Gesture.Pinch()
    .runOnJS(true)
    .onEnd((e) => {
      const next = resizeForPinch(e.scale, p.resizeMode);
      if (next !== p.resizeMode) p.onResize(next);
    });

  const gesture = Gesture.Race(pinch, pan, Gesture.Exclusive(double, single));
  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false} />
    </GestureDetector>
  );
}

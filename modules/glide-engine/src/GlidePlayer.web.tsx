import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { View } from 'react-native';

import type { GlidePlayerProps, GlidePlayerRef } from './GlideEngine.types';
import { getVolume, subscribeVolume } from './GlideEngineModule.web';
import { WebPlayerCore } from './web/core';

type Props = GlidePlayerProps & { ref?: Ref<GlidePlayerRef> };

const MODE = { off: 0, blend: 1, memc: 2 } as const;

/** Web version of the player: same props, events and ref functions as the Android view. */
export function GlidePlayer(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<WebPlayerCore | null>(null);
  // Latest callbacks, read by the core's events without re-creating it.
  const cbRef = useRef(props);
  useEffect(() => {
    cbRef.current = props;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const core = new WebPlayerCore(host, {
      onLoad: (e) => cbRef.current.onLoad?.({ nativeEvent: e }),
      onProgress: (e) => cbRef.current.onProgress?.({ nativeEvent: e }),
      onStats: (e) => cbRef.current.onStats?.({ nativeEvent: e }),
      onEnd: () => cbRef.current.onEnd?.(),
      onError: (e) => cbRef.current.onError?.({ nativeEvent: e }),
      onTracks: (e) => cbRef.current.onTracks?.({ nativeEvent: e }),
      onPlaybackState: (e) => cbRef.current.onPlaybackState?.({ nativeEvent: e }),
    });
    coreRef.current = core;
    core.setVolume(getVolume());
    const unsubscribe = subscribeVolume((v) => core.setVolume(v));
    return () => {
      unsubscribe();
      core.destroy();
      coreRef.current = null;
    };
  }, []);

  useImperativeHandle(
    props.ref,
    () => ({
      seekTo: async (ms: number) => coreRef.current?.seekTo(ms),
      setAudioTrack: async () => {},
      setTextTrack: async (id: string | null) => coreRef.current?.setTextTrack(id),
      enterPip: async () => false,
    }),
    [],
  );

  const { source, paused, rate = 1, muted = false, mode = 'memc', quality = 'balanced', targetFps = 0, compare = false, split = 0.5, showVectors = false, resizeMode = 'fit' } = props;

  useEffect(() => {
    coreRef.current?.setSource(source);
  }, [source]);
  useEffect(() => {
    coreRef.current?.setPaused(paused);
  }, [paused]);
  useEffect(() => {
    coreRef.current?.setRate(rate);
  }, [rate]);
  useEffect(() => {
    coreRef.current?.setMuted(muted);
  }, [muted]);
  useEffect(() => {
    const core = coreRef.current;
    if (!core) return;
    core.settings = { mode: MODE[mode], quality, targetFps, compare, split, vectors: showVectors, resize: resizeMode };
  }, [mode, quality, targetFps, compare, split, showVectors, resizeMode]);

  return (
    <View style={[{ backgroundColor: '#000', overflow: 'hidden' }, props.style]}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}

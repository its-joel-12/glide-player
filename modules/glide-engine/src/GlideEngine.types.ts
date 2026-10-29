import type { StyleProp, ViewStyle } from 'react-native';

/** Off = the frames as recorded, Blend = cross-fade, MEMC = motion-compensated in-between frames. */
export type SmoothingMode = 'off' | 'blend' | 'memc';
/** How much work motion estimation does (bigger = sharper motion, more battery). */
export type AnalysisQuality = 'fast' | 'balanced' | 'detailed';
export type ResizeMode = 'fit' | 'fill' | 'zoom';

export type SubtitleSource = { uri: string; mimeType?: string; language?: string; label?: string };

export type VideoSource = {
  /** file://, content:// or https:// */
  uri: string;
  title?: string;
  /** Where to start (only used when the video changes). */
  startPositionMs?: number;
  /** Extra subtitle files (.srt, .vtt, .ass). Changing these keeps the position. */
  subtitles?: SubtitleSource[];
};

export type LoadEvent = {
  durationMs: number;
  width: number;
  height: number;
  /** From the file; 0 when unknown. */
  frameRate: number;
  maxRefreshRate: number;
  /** False when this video plays without the smoothing pipeline. */
  smoothing: boolean;
};
export type ProgressEvent = { positionMs: number; durationMs: number; bufferedMs: number };
export type StatsEvent = {
  /** Frames per second coming out of the decoder. */
  inputFps: number;
  /** Frames per second sent to the screen. */
  outputFps: number;
  /** Made-up (in-between) frames per second. */
  generatedFps: number;
  sourceFps: number;
  targetFps: number;
  displayHz: number;
  motion: boolean;
  smoothing: boolean;
};
export type PlaybackStateEvent = { isPlaying: boolean; playWhenReady: boolean; buffering: boolean; ended: boolean };
export type Track = { id: string; label: string; language: string; selected: boolean };
export type TracksEvent = { audio: Track[]; text: Track[] };
export type PlayerErrorEvent = { message: string; code: string; fatal: boolean };

type NativeEvent<T> = { nativeEvent: T };

export type GlidePlayerProps = {
  source: VideoSource | null;
  paused: boolean;
  rate?: number;
  muted?: boolean;
  mode?: SmoothingMode;
  quality?: AnalysisQuality;
  /** Output frames per second; 0 = the screen's highest refresh rate. */
  targetFps?: number;
  compare?: boolean;
  /** 0..1 from the left. */
  split?: number;
  showVectors?: boolean;
  resizeMode?: ResizeMode;
  pipEnabled?: boolean;
  backgroundAudio?: boolean;
  subtitlesVisible?: boolean;
  style?: StyleProp<ViewStyle>;
  onLoad?: (e: NativeEvent<LoadEvent>) => void;
  onProgress?: (e: NativeEvent<ProgressEvent>) => void;
  onStats?: (e: NativeEvent<StatsEvent>) => void;
  onEnd?: () => void;
  onError?: (e: NativeEvent<PlayerErrorEvent>) => void;
  onTracks?: (e: NativeEvent<TracksEvent>) => void;
  onPlaybackState?: (e: NativeEvent<PlaybackStateEvent>) => void;
  onPipChange?: (e: NativeEvent<{ active: boolean }>) => void;
};

/** Functions on the player, called through a ref. */
export type GlidePlayerRef = {
  seekTo(positionMs: number): Promise<void>;
  /** null = back to the automatic choice. */
  setAudioTrack(id: string | null): Promise<void>;
  /** null = subtitles off. */
  setTextTrack(id: string | null): Promise<void>;
  enterPip(): Promise<boolean>;
};

export type ExportOptions = {
  uri: string;
  title: string;
  /** Frames per second of the saved video. */
  fps: number;
  /** 1 = normal speed; 2, 4 or 8 = that many times slower. */
  slowMotion: number;
  quality: 'balanced' | 'detailed' | 'export';
  keepAudio: boolean;
  /** Video size, for the encoder bitrate. */
  width: number;
  height: number;
};
export type ExportResult = {
  /** content:// in the gallery (Movies/Glide), or the file itself on older Android. */
  uri: string;
  /** The copy in the app's cache, for sharing. */
  fileUri: string;
  savedToGallery: boolean;
  fileSizeBytes: number;
  name: string;
};
export type DisplayInfo = { refreshRates: number[]; maxRefreshRate: number; currentRefreshRate: number };

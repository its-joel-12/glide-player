import type { StyleProp, ViewStyle } from 'react-native';

/** Off = the frames as recorded, Blend = cross-fade, MEMC = motion-compensated in-between frames. */
export type SmoothingMode = 'off' | 'blend' | 'memc';
/** How much work motion estimation does (bigger = sharper motion, more battery). */
export type AnalysisQuality = 'fast' | 'balanced' | 'detailed';
export type ResizeMode = 'fit' | 'fill' | 'zoom';

/** How subtitles look. */
export type SubtitleStyle = {
  /** 1 = normal size (0.5–2). */
  scale: number;
  font: 'sans' | 'serif' | 'mono' | 'condensed' | 'casual';
  bold: boolean;
  /** #RRGGBB */
  color: string;
  /** none, a box behind the text, or a full-width band */
  background: 'none' | 'box' | 'band';
  backgroundColor: string;
  /** 0..1 */
  backgroundOpacity: number;
  edge: 'none' | 'outline' | 'shadow' | 'raised' | 'depressed';
  edgeColor: string;
  /** Distance from the bottom of the picture, as a fraction of its height (0–0.4). */
  position: number;
  /** Use the colours, fonts and sizes in the subtitle file itself (ASS, embedded tracks). */
  useFileStyles: boolean;
};

export type SubtitleSource = {
  uri: string;
  mimeType?: string;
  language?: string;
  label?: string;
  /** Switch this one on at the start (otherwise the last file added is switched on). */
  selected?: boolean;
};

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
  /** False when the file can't be skipped through (e.g. an MKV without a seek index). */
  seekable?: boolean;
  /** Container type, e.g. "video/x-matroska" (Android; empty when unknown). */
  container?: string;
};
export type ProgressEvent = { positionMs: number; durationMs: number; bufferedMs: number; seekable?: boolean };
export type StatsEvent = {
  /** Frames per second coming out of the decoder. */
  inputFps: number;
  /** Frames per second sent to the screen. */
  outputFps: number;
  /** Made-up (in-between) frames per second. */
  generatedFps: number;
  /** Frames per second that actually reached the screen. */
  renderedFps: number;
  /** Frames per second the player had to drop (too late). */
  droppedFps: number;
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
  /** Positive = sound later than the picture (ms). */
  audioDelayMs?: number;
  /** Positive = subtitles later (ms). */
  subtitleDelayMs?: number;
  subtitleStyle?: SubtitleStyle;
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
  /**
   * Make a seekable copy instead: same picture and main audio track rewritten into an MP4 (which
   * always has a seek index), copied without re-encoding when MP4 can hold the streams.
   * fps, slowMotion and quality are ignored.
   */
  remux?: boolean;
};
export type ExportResult = {
  /** content:// in the gallery (Movies/Glide), or the file itself on older Android. */
  uri: string;
  /** The copy in the app's cache, for sharing. */
  fileUri: string;
  savedToGallery: boolean;
  fileSizeBytes: number;
  name: string;
  /** Seekable copies: text subtitles saved as files (MP4 can't hold them), loaded with the copy. */
  subtitles?: SubtitleSource[];
  /** Seekable copies: tracks that couldn't be kept, in plain words. */
  notes?: string[];
};
export type DisplayInfo = { refreshRates: number[]; maxRefreshRate: number; currentRefreshRate: number };

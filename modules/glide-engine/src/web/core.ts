/**
 * The web player: an HTML <video> (or the demo clip) feeding the WebGL motion engine, drawn on a
 * canvas at the screen's refresh rate. Each new video frame is analysed as it arrives
 * (requestVideoFrameCallback); the picture runs a little over one frame behind so there's always
 * a "next" frame to interpolate towards, and the sound is delayed by the same amount (Web Audio).
 */
import type { LoadEvent, PlaybackStateEvent, PlayerErrorEvent, ProgressEvent, ResizeMode, StatsEvent, SubtitleStyle, TracksEvent } from '../GlideEngine.types';
import { DEMO_FPS, DEMO_H, DEMO_LENGTH, DEMO_URI, DEMO_W, drawDemo } from './demo';
import { WebMotionEngine, type Frame, type Quality, type Rect } from './engine';
import { DEFAULT_SUBTITLE_STYLE, subtitleCss } from './subtitle-style';
import { cueAt, parseSubtitles, type Cue } from './subtitles';

export type CoreCallbacks = {
  onLoad: (e: LoadEvent) => void;
  onProgress: (e: ProgressEvent) => void;
  onStats: (e: StatsEvent) => void;
  onEnd: () => void;
  onError: (e: PlayerErrorEvent) => void;
  onTracks: (e: TracksEvent) => void;
  onPlaybackState: (e: PlaybackStateEvent) => void;
};

export type CoreSettings = {
  mode: 0 | 1 | 2;
  quality: Quality;
  targetFps: number;
  compare: boolean;
  split: number;
  vectors: boolean;
  /** Live upscaling of videos smaller than the screen (edge-directed resample + sharpening). */
  upscale: boolean;
  /** 0..1 */
  sharpness: number;
  resize: ResizeMode;
  /** Seconds; positive = sound later than the picture. */
  audioDelay: number;
  /** Seconds; positive = subtitles later. */
  subtitleDelay: number;
};

type Source = { uri: string; startPositionMs?: number; subtitles?: { uri: string; label?: string; language?: string }[] };
type TextTrack = { id: string; label: string; language: string; cues: Cue[] };
type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, md: { mediaTime: number; expectedDisplayTime?: number }) => void) => number;
  cancelVideoFrameCallback?: (h: number) => void;
};

const KEEP = 3; // frames kept: A, B and the newest one
const MAX_KEEP = 14; // with the picture held back (negative audio delay)
/** The web can hold the picture back by at most this much (it keeps decoded frames on the GPU). */
export const MIN_AUDIO_DELAY = -0.5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

export class WebPlayerCore {
  settings: CoreSettings = {
    mode: 2,
    quality: 'balanced',
    targetFps: 0,
    compare: false,
    split: 0.5,
    vectors: false,
    upscale: false,
    sharpness: 0.5,
    resize: 'fit',
    audioDelay: 0,
    subtitleDelay: 0,
  };

  private readonly video: VideoWithRVFC;
  private readonly canvas: HTMLCanvasElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly subtitleText: HTMLSpanElement;
  private engine: WebMotionEngine | null = null;
  private frames: Frame[] = [];
  private dts: number[] = [];
  private frameDur = 1 / 30;
  private margin = 0.02;
  private clock = { media: 0, wall: 0, valid: false };
  private uri = '';
  private subtitleKey = '';
  private startAt = 0;
  private loadedSent = false;
  private wantPaused = true;
  private rate = 1;
  private destroyed = false;
  private raf = 0;
  private rvfc = 0;
  private rafDts: number[] = [];
  private lastRaf = 0;
  private lastProgress = 0;
  private lastStats = 0;
  private counts = { input: 0, output: 0, generated: 0, lastShown: -1 };
  /** Browser's running count of dropped video frames at the last stats tick. */
  private droppedTotal = -1;
  private tracks: TextTrack[] = [];
  private textId: string | null = null;
  private shownTime = 0;
  private demo: { on: boolean; media: number; last: number; idx: number; canvas: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null } = {
    on: false,
    media: 0,
    last: 0,
    idx: -1,
    canvas: null,
    ctx: null,
  };
  private audio: { ctx: AudioContext; delay: DelayNode; routed: boolean } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly cb: CoreCallbacks,
  ) {
    const video = document.createElement('video') as VideoWithRVFC;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');
    Object.assign(video.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000' });
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    const subs = document.createElement('div');
    Object.assign(subs.style, { position: 'absolute', left: '0', right: '0', textAlign: 'center', lineHeight: '1.3', whiteSpace: 'pre-line', pointerEvents: 'none' });
    const subsText = document.createElement('span');
    Object.assign(subsText.style, { display: 'inline-block', maxWidth: '88%', borderRadius: '0.15em', boxDecorationBreak: 'clone' });
    subs.append(subsText);
    this.subtitleText = subsText;
    host.append(video, canvas, subs);
    this.video = video;
    this.canvas = canvas;
    this.subtitleEl = subs;
    this.setSubtitleStyle(DEFAULT_SUBTITLE_STYLE);

    try {
      this.engine = new WebMotionEngine(canvas, KEEP + 1);
    } catch {
      // No WebGL 2: show the plain video.
      this.engine = null;
      canvas.style.display = 'none';
    }

    for (const ev of ['play', 'pause', 'waiting', 'playing', 'ratechange', 'seeked', 'ended'] as const) {
      video.addEventListener(ev, this.onStateEvent);
    }
    video.addEventListener('seeking', this.onSeeking);
    video.addEventListener('seeked', this.onStill);
    video.addEventListener('loadeddata', this.onStill);
    video.addEventListener('loadedmetadata', this.onMetadata);
    video.addEventListener('ended', this.onEnded);
    video.addEventListener('error', this.onVideoError);
    document.addEventListener('pointerdown', this.onGesture, true);
    document.addEventListener('keydown', this.onGesture, true);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(host);
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------- public API

  get smoothingAvailable() {
    return this.engine != null;
  }

  setSource(src: Source | null) {
    if (!src?.uri) return;
    const subKey = (src.subtitles ?? []).map((s) => s.uri).join('|');
    if (src.uri === this.uri) {
      if (subKey !== this.subtitleKey) this.loadSubtitles(src.subtitles ?? [], subKey);
      return;
    }
    this.uri = src.uri;
    this.loadedSent = false;
    this.startAt = (src.startPositionMs ?? 0) / 1000;
    this.resetFrames();
    this.dts = [];
    this.margin = 0.02;
    this.loadSubtitles(src.subtitles ?? [], subKey);
    if (src.uri === DEMO_URI) {
      this.startDemo();
    } else {
      this.demo.on = false;
      this.video.style.visibility = 'visible';
      this.video.src = src.uri;
      if (!this.wantPaused) void this.video.play().catch(() => this.emitState());
    }
  }

  setPaused(paused: boolean) {
    this.wantPaused = paused;
    if (this.demo.on) {
      this.demo.last = performance.now();
      this.emitState();
      return;
    }
    if (!this.video.src) return;
    if (paused) {
      if (!this.video.paused) this.video.pause();
    } else if (this.video.paused || this.video.ended) {
      if (this.video.ended) this.video.currentTime = 0;
      void this.video.play().catch(() => {
        this.wantPaused = true;
        this.emitState();
      });
    }
  }

  setRate(rate: number) {
    this.rate = rate;
    this.video.playbackRate = rate;
    this.clock.valid = false;
  }

  setMuted(muted: boolean) {
    this.video.muted = muted;
  }

  setVolume(v: number) {
    this.video.volume = Math.min(1, Math.max(0, v));
  }

  seekTo(ms: number) {
    const s = Math.max(0, ms / 1000);
    if (this.demo.on) {
      this.demo.media = Math.min(DEMO_LENGTH - 0.05, s);
      this.demo.idx = -1;
      this.resetFrames();
    } else if (Number.isFinite(this.video.duration)) {
      this.video.currentTime = Math.min(this.video.duration - 0.05, s);
    }
  }

  setSubtitleStyle(style: SubtitleStyle) {
    const css = subtitleCss(style);
    Object.assign(this.subtitleEl.style, css.box);
    Object.assign(this.subtitleText.style, css.text);
  }

  /** Seconds the picture is held back beyond the normal one-frame delay (for negative audio delay). */
  private extraDelay() {
    return Math.max(0, -Math.max(MIN_AUDIO_DELAY, this.settings.audioDelay));
  }

  private keepFrames() {
    const extraMedia = this.extraDelay() * this.rate;
    return Math.min(MAX_KEEP, KEEP + Math.ceil(extraMedia / Math.max(0.01, this.frameDur)));
  }

  /** Delay for the sound (seconds), so it lines up with the picture plus the chosen audio delay. */
  updateAudioDelay() {
    const a = this.audio;
    if (!a?.routed) return;
    const audioDelay = Math.max(MIN_AUDIO_DELAY, this.settings.audioDelay);
    const picture = this.frameDur / this.rate + this.margin + this.extraDelay();
    a.delay.delayTime.setTargetAtTime(Math.min(3.9, Math.max(0, picture + audioDelay)), a.ctx.currentTime, 0.05);
  }

  setTextTrack(id: string | null) {
    this.textId = id;
    this.emitTracks();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    if (this.rvfc) this.video.cancelVideoFrameCallback?.(this.rvfc);
    document.removeEventListener('pointerdown', this.onGesture, true);
    document.removeEventListener('keydown', this.onGesture, true);
    this.resizeObserver?.disconnect();
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
    void this.audio?.ctx.close().catch(() => {});
    this.engine?.release();
    this.video.remove();
    this.canvas.remove();
    this.subtitleEl.remove();
  }

  // ---------- sources

  private startDemo() {
    this.demo.on = true;
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.style.visibility = 'hidden';
    if (!this.demo.canvas) {
      this.demo.canvas = document.createElement('canvas');
      this.demo.canvas.width = DEMO_W;
      this.demo.canvas.height = DEMO_H;
      this.demo.ctx = this.demo.canvas.getContext('2d');
    }
    this.demo.media = Math.min(DEMO_LENGTH - 0.05, this.startAt);
    this.demo.idx = -1;
    this.demo.last = performance.now();
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.loadedSent = true;
      this.cb.onLoad({ durationMs: DEMO_LENGTH * 1000, width: DEMO_W, height: DEMO_H, frameRate: DEMO_FPS, maxRefreshRate: this.displayHz(), smoothing: this.engine != null });
      this.emitTracks();
      this.emitState();
    });
  }

  private demoTick(now: number) {
    const d = this.demo;
    const dt = Math.min(0.1, (now - d.last) / 1000);
    d.last = now;
    if (!this.wantPaused) d.media += dt * this.rate;
    if (d.media >= DEMO_LENGTH) {
      d.media = DEMO_LENGTH;
      if (!this.wantPaused) {
        this.wantPaused = true;
        this.emitState(true);
        this.cb.onEnd();
      }
    }
    const idx = Math.min(Math.floor(d.media * DEMO_FPS + 1e-6), DEMO_LENGTH * DEMO_FPS - 1);
    if (idx !== d.idx && d.ctx && d.canvas) {
      if (!this.frames.length && idx > 0) {
        drawDemo(d.ctx, (idx - 1) / DEMO_FPS, idx - 1);
        this.ingest(d.canvas, (idx - 1) / DEMO_FPS, DEMO_W, DEMO_H);
      }
      d.idx = idx;
      drawDemo(d.ctx, idx / DEMO_FPS, idx);
      this.ingest(d.canvas, idx / DEMO_FPS, DEMO_W, DEMO_H);
    }
  }

  private async loadSubtitles(list: { uri: string; label?: string; language?: string }[], key: string) {
    this.subtitleKey = key;
    const loaded: TextTrack[] = [];
    for (const [i, s] of list.entries()) {
      try {
        const text = await (await fetch(s.uri)).text();
        loaded.push({ id: `file:${i}`, label: s.label ?? `Subtitles ${i + 1}`, language: s.language ?? '', cues: parseSubtitles(text, s.label ?? s.uri) });
      } catch {
        this.cb.onError({ message: `Couldn’t read the subtitle file ${s.label ?? ''}.`, code: 'SUBTITLES', fatal: false });
      }
    }
    if (this.destroyed || key !== this.subtitleKey) return;
    this.tracks = loaded;
    this.textId = loaded.length ? loaded[loaded.length - 1].id : null;
    this.emitTracks();
  }

  // ---------- video events

  private onMetadata = () => {
    const v = this.video;
    if (this.startAt > 0 && this.startAt < v.duration - 1) v.currentTime = this.startAt;
    if (this.rvfc) v.cancelVideoFrameCallback?.(this.rvfc);
    if (v.requestVideoFrameCallback) this.rvfc = v.requestVideoFrameCallback(this.onVideoFrame);
    if (!this.loadedSent) {
      this.loadedSent = true;
      this.cb.onLoad({
        durationMs: Number.isFinite(v.duration) ? v.duration * 1000 : 0,
        width: v.videoWidth,
        height: v.videoHeight,
        frameRate: 0,
        maxRefreshRate: this.displayHz(),
        smoothing: this.engine != null,
      });
      this.emitTracks();
    }
    this.layout();
  };

  private onVideoFrame = (now: number, md: { mediaTime: number; expectedDisplayTime?: number }) => {
    if (this.destroyed) return;
    this.rvfc = this.video.requestVideoFrameCallback!(this.onVideoFrame);
    if (this.demo.on) return;
    this.ingest(this.video, md.mediaTime, this.video.videoWidth, this.video.videoHeight);
    if (this.isPlaying()) this.syncClock(md.mediaTime, md.expectedDisplayTime ?? now);
  };

  private lastPolled = -1;
  private poll(now: number) {
    const v = this.video;
    if (v.readyState < 2 || this.demo.on) return;
    if (v.currentTime !== this.lastPolled) {
      this.lastPolled = v.currentTime;
      this.ingest(v, v.currentTime, v.videoWidth, v.videoHeight);
      if (this.isPlaying()) this.syncClock(v.currentTime, now);
    }
  }

  private onSeeking = () => {
    if (!this.demo.on) this.resetFrames();
  };

  /** After a seek or the first load while paused, show that frame (frame callbacks may not fire). */
  private onStill = () => {
    const v = this.video;
    if (this.demo.on || this.isPlaying() || v.readyState < 2) return;
    this.ingest(v, v.currentTime, v.videoWidth, v.videoHeight);
  };

  private onEnded = () => {
    if (!this.demo.on) this.cb.onEnd();
  };

  private onVideoError = () => {
    if (this.demo.on || !this.video.src) return;
    const code = this.video.error?.code ?? 0;
    const message =
      code === 4
        ? 'This browser can’t play this file. MP4 (H.264) and WebM play almost everywhere; MKV and HEVC often don’t.'
        : 'The video couldn’t be loaded. If you refreshed the page, open the file again.';
    this.cb.onError({ message, code: `MEDIA_ERR_${code}`, fatal: true });
  };

  private onStateEvent = () => {
    this.clock.valid = false;
    this.emitState();
  };

  private emitState(ended = false) {
    if (this.demo.on) {
      this.cb.onPlaybackState({ isPlaying: !this.wantPaused, playWhenReady: !this.wantPaused, buffering: false, ended: ended || this.demo.media >= DEMO_LENGTH });
      return;
    }
    const v = this.video;
    this.cb.onPlaybackState({ isPlaying: !v.paused && !v.ended, playWhenReady: !v.paused, buffering: !v.paused && v.readyState < 3, ended: v.ended });
  }

  private emitTracks() {
    this.cb.onTracks({ audio: [], text: this.tracks.map((t) => ({ id: t.id, label: t.label, language: t.language, selected: t.id === this.textId })) });
  }

  /** The first tap/key press lets the page start Web Audio, which delays the sound to match the picture. */
  private onGesture = () => {
    if (this.audio || this.demo.on || !this.engine) return;
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const delay = ctx.createDelay(4);
      this.audio = { ctx, delay, routed: false };
      void ctx.resume().then(() => {
        if (ctx.state !== 'running' || !this.audio || this.audio.routed || this.destroyed) return;
        const node = ctx.createMediaElementSource(this.video);
        node.connect(delay).connect(ctx.destination);
        this.audio.routed = true;
        this.updateAudioDelay();
      });
    } catch {
      this.audio = null;
    }
  };

  // ---------- frames and clock

  private isPlaying() {
    return this.demo.on ? !this.wantPaused : !this.video.paused && !this.video.ended;
  }

  private resetFrames() {
    this.frames = [];
    this.clock.valid = false;
  }

  private ingest(src: TexImageSource, t: number, w: number, h: number) {
    const e = this.engine;
    if (!e || !w || !h) return;
    const keep = this.keepFrames();
    e.setSlotCount(keep + 1);
    if (e.configure(w, h, this.settings.quality)) this.frames = [];
    const last = this.frames[this.frames.length - 1];
    if (last) {
      if (t < last.t - 1e-3) this.frames = [];
      else if (t <= last.t + 1e-4) return;
    }
    while (this.frames.length >= keep) this.frames.shift();
    const f = e.ingest(src, t, new Set(this.frames));
    const prev = this.frames[this.frames.length - 1];
    if (prev) {
      const dt = t - prev.t;
      if (dt > 0 && dt < 0.25) {
        this.dts.push(dt);
        if (this.dts.length > 15) this.dts.shift();
        this.frameDur = median(this.dts);
        if (this.settings.mode === 2) e.estimate(prev, f);
      }
    }
    this.frames.push(f);
    this.counts.input++;
  }

  private syncClock(m: number, wall: number) {
    const pred = this.clock.media + ((wall - this.clock.wall) / 1000) * this.video.playbackRate;
    const err = m - pred;
    if (!this.clock.valid || Math.abs(err) > 0.12) this.clock = { media: m, wall, valid: true };
    else this.clock = { media: pred + err * 0.08, wall, valid: true };
  }

  private mediaNow(now: number) {
    if (this.demo.on) return this.demo.media;
    if (!this.isPlaying() || !this.clock.valid) return this.video.currentTime;
    return this.clock.media + ((now - this.clock.wall) / 1000) * this.video.playbackRate;
  }

  private displayHz() {
    return this.rafDts.length ? Math.round(1000 / median(this.rafDts)) : 60;
  }

  // ---------- drawing

  private layout() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.host.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.host.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  private rect(): Rect {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const vw = this.engine?.width || 16;
    const vh = this.engine?.height || 9;
    if (this.settings.resize === 'fill') return { x: 0, y: 0, w: cw, h: ch };
    const s = this.settings.resize === 'zoom' ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
    const w = vw * s;
    const h = vh * s;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  private loop = (now: number) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.lastRaf) {
      this.rafDts.push(now - this.lastRaf);
      if (this.rafDts.length > 90) this.rafDts.shift();
    }
    this.lastRaf = now;
    if (this.demo.on) this.demoTick(now);
    else if (!this.video.requestVideoFrameCallback) this.poll(now);
    this.draw(now);
    this.updateSubtitles();
    if (now - this.lastProgress > 250) {
      this.lastProgress = now;
      const durationMs = this.demo.on ? DEMO_LENGTH * 1000 : Number.isFinite(this.video.duration) ? this.video.duration * 1000 : 0;
      const positionMs = (this.demo.on ? this.demo.media : this.video.currentTime) * 1000;
      let bufferedMs = 0;
      const b = this.video.buffered;
      if (!this.demo.on && b.length) bufferedMs = b.end(b.length - 1) * 1000;
      this.cb.onProgress({ positionMs, durationMs, bufferedMs: this.demo.on ? durationMs : bufferedMs });
    }
    if (now - this.lastStats > 1000) {
      const dt = this.lastStats ? (now - this.lastStats) / 1000 : 1;
      this.lastStats = now;
      const hz = this.displayHz();
      const dropTotal = this.video.getVideoPlaybackQuality?.().droppedVideoFrames ?? 0;
      const dropped = this.droppedTotal < 0 ? 0 : Math.max(0, dropTotal - this.droppedTotal);
      this.droppedTotal = dropTotal;
      this.cb.onStats({
        inputFps: this.counts.input / dt,
        outputFps: this.counts.output / dt,
        generatedFps: this.counts.generated / dt,
        renderedFps: this.counts.output / dt,
        droppedFps: dropped / dt,
        sourceFps: this.frames.length > 1 ? 1 / this.frameDur : 0,
        targetFps: this.settings.targetFps || hz,
        displayHz: hz,
        motion: this.settings.mode === 2 && !!this.engine?.motionSupported,
        smoothing: this.engine != null,
        upscaleFromWidth: this.engine?.width ?? 0,
        upscaleFromHeight: this.engine?.height ?? 0,
        upscaleToWidth: this.engine?.upscaledTo[0] || this.engine?.width || 0,
        upscaleToHeight: this.engine?.upscaledTo[1] || this.engine?.height || 0,
      });
      this.counts.input = 0;
      this.counts.output = 0;
      this.counts.generated = 0;
      this.updateAudioDelay();
    }
  };

  private draw(now: number) {
    const e = this.engine;
    if (!e) return;
    this.layout();
    if (!this.frames.length) {
      e.clear();
      return;
    }
    const s = this.settings;
    const split = s.compare && (s.mode !== 0 || s.upscale) ? s.split : -1;
    const up = { on: s.upscale, sharpness: s.sharpness };
    const last = this.frames[this.frames.length - 1];
    if (!this.isPlaying()) {
      const fields = s.vectors && last.fieldsFrom >= 0;
      e.render(last, last, 0, 0, fields, split, s.vectors, this.rect(), up);
      this.shownTime = last.t;
      return;
    }
    let target = this.mediaNow(now) - (this.frameDur + (this.margin + this.extraDelay()) * this.rate);
    if (s.targetFps > 0 && s.targetFps < this.displayHz() - 1) {
      const step = this.rate / s.targetFps;
      target = Math.floor(target / step) * step;
    }
    let a = last;
    let b = last;
    let t = 0;
    if (target >= last.t) {
      if (!this.demo.on && this.video.readyState >= 3 && target - last.t < this.frameDur) this.margin = Math.min(0.12, this.margin + 0.004);
    } else if (target <= this.frames[0].t) {
      a = b = this.frames[0];
    } else {
      let i = 0;
      while (i < this.frames.length - 2 && this.frames[i + 1].t <= target) i++;
      a = this.frames[i];
      b = this.frames[i + 1];
      t = (target - a.t) / (b.t - a.t);
    }
    const mode = a === b ? 0 : s.mode;
    const fields = a === b ? s.vectors && a.fieldsFrom >= 0 : s.mode === 2 && b.fieldsFrom === a.serial;
    e.render(a, b, t, mode, fields, split, s.vectors, this.rect(), up);
    const shown = mode === 0 ? a.t : a.t + t * (b.t - a.t);
    if (shown !== this.counts.lastShown) {
      this.counts.output++;
      if (mode > 0 && t > 0.001 && t < 0.999) this.counts.generated++;
      this.counts.lastShown = shown;
    }
    this.shownTime = shown;
  }

  private updateSubtitles() {
    const track = this.tracks.find((t) => t.id === this.textId);
    const time = this.engine ? this.shownTime : this.video.currentTime;
    const text = track ? cueAt(track.cues, time - this.settings.subtitleDelay) : '';
    if (this.subtitleText.textContent !== text) this.subtitleText.textContent = text;
    this.subtitleEl.style.visibility = text ? 'visible' : 'hidden';
  }
}

package expo.modules.glide

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ForwardingRenderer
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.text.TextOutput
import androidx.media3.exoplayer.video.VideoRendererEventListener
import java.util.concurrent.atomic.AtomicLong

/**
 * Audio and subtitle delay, like VLC. Written on the main thread, read on the playback thread.
 *
 * Audio drives the player's clock, so "audio delay" moves the picture instead: with audio
 * delayed by d the video renderer is asked for the picture at (clock + d). Subtitles follow the
 * picture, shifted by their own delay. Both directions work because decoders run ahead.
 */
internal class PlaybackTiming {
  /** Positive = sound later than the picture. */
  @Volatile var audioDelayUs = 0L
  /** Positive = subtitles later than the picture. */
  @Volatile var subtitleDelayUs = 0L

  /** Frames actually handed to the screen, and frames the player dropped (for the frame-rate readout). */
  val renderedFrames = AtomicLong()
  val droppedFrames = AtomicLong()
}

/** Asks the wrapped renderer for a shifted position. */
@OptIn(UnstableApi::class)
internal class ShiftedRenderer(renderer: Renderer, private val shiftUs: () -> Long) : ForwardingRenderer(renderer) {
  override fun render(positionUs: Long, elapsedRealtimeUs: Long) {
    super.render(positionUs + shiftUs(), elapsedRealtimeUs)
  }
}

@OptIn(UnstableApi::class)
internal class GlideRenderersFactory(context: Context, private val timing: PlaybackTiming) : DefaultRenderersFactory(context) {
  init {
    setEnableDecoderFallback(true)
    // Adds Media3's FFmpeg audio renderer after the phone's own decoders, so audio the phone can't
    // decode (Dolby Digital AC-3 on most phones, DTS, TrueHD) is decoded in software, like VLC does.
    setExtensionRendererMode(EXTENSION_RENDERER_MODE_ON)
  }

  override fun buildVideoRenderers(
    context: Context,
    extensionRendererMode: Int,
    mediaCodecSelector: MediaCodecSelector,
    enableDecoderFallback: Boolean,
    eventHandler: Handler,
    eventListener: VideoRendererEventListener,
    allowedVideoJoiningTimeMs: Long,
    out: ArrayList<Renderer>,
  ) {
    val start = out.size
    super.buildVideoRenderers(context, extensionRendererMode, mediaCodecSelector, enableDecoderFallback, eventHandler, eventListener, allowedVideoJoiningTimeMs, out)
    for (i in start until out.size) out[i] = ShiftedRenderer(out[i]) { timing.audioDelayUs }
  }

  override fun buildTextRenderers(
    context: Context,
    output: TextOutput,
    outputLooper: Looper,
    extensionRendererMode: Int,
    out: ArrayList<Renderer>,
  ) {
    val start = out.size
    super.buildTextRenderers(context, output, outputLooper, extensionRendererMode, out)
    for (i in start until out.size) out[i] = ShiftedRenderer(out[i]) { timing.audioDelayUs - timing.subtitleDelayUs }
  }
}

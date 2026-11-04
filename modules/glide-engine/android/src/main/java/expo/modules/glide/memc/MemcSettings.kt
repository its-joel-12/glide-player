package expo.modules.glide.memc

import java.util.concurrent.atomic.AtomicLong

/** How much work motion estimation does. The long side of the analysed picture, in pixels. */
internal enum class Quality(val key: String, val longSide: Int, val extraFinePass: Boolean) {
  FAST("fast", 480, false),
  BALANCED("balanced", 640, false),
  DETAILED("detailed", 960, false),

  /** Used for saved videos: bigger analysis picture and an extra quarter-pixel refinement. */
  EXPORT("export", 1280, true);

  companion object {
    fun from(key: String?): Quality = entries.firstOrNull { it.key == key } ?: BALANCED
  }
}

/**
 * Settings shared between the UI thread (writes) and the video processing GL thread (reads).
 * The GL thread takes a [snapshot] per frame so one frame never mixes old and new values.
 */
internal class MemcSettings {
  @Volatile var mode: Int = MODE_MEMC
  /** Output frames per second of media time at 1× speed (normally the screen's refresh rate). */
  @Volatile var targetFps: Float = 60f
  /** Playback speed. At 0.5× twice as many frames are made per second of video. */
  @Volatile var speed: Float = 1f
  @Volatile var quality: Quality = Quality.BALANCED
  @Volatile var compare: Boolean = false
  /** Where the split line is, 0..1 from the left. */
  @Volatile var split: Float = 0.5f
  @Volatile var showVectors: Boolean = false
  /** Frames further apart than this are not interpolated (seeks, gaps, slide shows). */
  @Volatile var maxGapUs: Long = 250_000L
  /** Live upscaling: resample small videos to the size they're shown at, edge-directed, then sharpen. */
  @Volatile var upscale: Boolean = false
  /** Sharpening after upscaling, 0..1. */
  @Volatile var sharpness: Float = 0.5f
  /** Size of the picture on screen in pixels (the video surface); 0 = unknown. */
  @Volatile var viewWidth: Int = 0
  @Volatile var viewHeight: Int = 0

  data class Snapshot(
    val mode: Int,
    val targetFps: Float,
    val speed: Float,
    val quality: Quality,
    val compare: Boolean,
    val split: Float,
    val showVectors: Boolean,
    val maxGapUs: Long,
    val upscale: Boolean,
    val sharpness: Float,
    val viewWidth: Int,
    val viewHeight: Int,
  )

  fun snapshot() = Snapshot(mode, targetFps, speed, quality, compare, split, showVectors, maxGapUs, upscale, sharpness, viewWidth, viewHeight)

  companion object {
    const val MODE_OFF = 0
    const val MODE_BLEND = 1
    const val MODE_MEMC = 2
  }
}

/** Counters the player view turns into frames-per-second readouts. */
internal class MemcStats {
  val inputFrames = AtomicLong()
  val outputFrames = AtomicLong()
  val generatedFrames = AtomicLong()
  @Volatile var motionActive = false
  /** Live upscaling: size of the video going in and of the picture coming out (equal when it isn't scaling). */
  @Volatile var upscaleInWidth = 0
  @Volatile var upscaleInHeight = 0
  @Volatile var upscaleOutWidth = 0
  @Volatile var upscaleOutHeight = 0

  fun onInput() {
    inputFrames.incrementAndGet()
  }

  fun onOutput(generated: Boolean) {
    outputFrames.incrementAndGet()
    if (generated) generatedFrames.incrementAndGet()
  }
}

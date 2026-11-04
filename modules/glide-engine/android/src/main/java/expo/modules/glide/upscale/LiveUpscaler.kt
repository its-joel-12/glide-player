package expo.modules.glide.upscale

import android.content.Context
import android.opengl.GLES30
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.GlObjectsProvider
import androidx.media3.common.GlTextureInfo
import androidx.media3.common.VideoFrameProcessingException
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import expo.modules.glide.memc.GlKit
import expo.modules.glide.memc.GlProg
import expo.modules.glide.memc.GlTex
import expo.modules.glide.memc.MemcSettings
import expo.modules.glide.memc.MemcStats
import expo.modules.glide.memc.Shaders
import java.util.concurrent.Executor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Live upscaling for playback, after the smoothing effect: small videos are resampled to the size
 * they're shown at with an edge-directed filter ([Shaders.UPSCALE]) and then sharpened
 * ([Shaders.SHARPEN]), on the GPU, for every frame that reaches the screen. When it's off (or the
 * video is already about as big as the picture on screen) frames are copied through unchanged.
 */
@OptIn(UnstableApi::class)
internal class LiveUpscaleEffect(
  private val settings: MemcSettings,
  private val stats: MemcStats?,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
    LiveUpscaleProgram(settings, stats, useHdr)
}

/** Picks the output size for a [w]×[h] frame shown in a [viewW]×[viewH] surface. */
internal object UpscaleSize {
  const val MAX_SCALE = 4f
  /** Below this there's nothing to gain from resampling here (the screen scales the rest). */
  const val MIN_SCALE = 1.15f
  const val MAX_OUTPUT_PIXELS = 3840L * 2160L

  fun forView(w: Int, h: Int, viewW: Int, viewH: Int): IntArray {
    if (w <= 0 || h <= 0 || viewW <= 0 || viewH <= 0) return intArrayOf(w, h)
    var scale = min(MAX_SCALE, min(viewW.toFloat() / w, viewH.toFloat() / h))
    val pixels = w.toLong() * h
    if (pixels * scale * scale > MAX_OUTPUT_PIXELS) scale = sqrt(MAX_OUTPUT_PIXELS.toFloat() / pixels)
    if (scale < MIN_SCALE) return intArrayOf(w, h)
    return intArrayOf(even(w * scale), even(h * scale))
  }

  private fun even(v: Float) = max(2, (v.roundToInt() + 1) and 1.inv())
}

@OptIn(UnstableApi::class)
internal class LiveUpscaleProgram(
  private val settings: MemcSettings,
  private val stats: MemcStats?,
  private val useHdr: Boolean,
) : GlShaderProgram {

  private class Output(val tex: GlTex, val info: GlTextureInfo) {
    var inUse = false
  }

  private class Programs {
    val upscale = GlProg(Shaders.VERTEX, Shaders.UPSCALE)
    val sharpen = GlProg(Shaders.VERTEX, Shaders.SHARPEN)
    val copy = GlProg(Shaders.VERTEX, Shaders.COPY)

    fun delete() {
      upscale.delete(); sharpen.delete(); copy.delete()
    }
  }

  private var inputListener: GlShaderProgram.InputListener = object : GlShaderProgram.InputListener {}
  private var outputListener: GlShaderProgram.OutputListener = object : GlShaderProgram.OutputListener {}
  private var errorListener: GlShaderProgram.ErrorListener? = null
  private var errorExecutor: Executor = Executor { it.run() }

  private var programs: Programs? = null
  private val outputs = ArrayList<Output>()
  /** Old-size outputs still held downstream after a size change; deleted once released. */
  private val retired = ArrayList<Output>()
  /** The upscaled picture before sharpening. */
  private var mid: GlTex? = null

  override fun setInputListener(inputListener: GlShaderProgram.InputListener) {
    this.inputListener = inputListener
    repeat(freeCount()) { inputListener.onReadyToAcceptInputFrame() }
  }

  override fun setOutputListener(outputListener: GlShaderProgram.OutputListener) {
    this.outputListener = outputListener
  }

  override fun setErrorListener(executor: Executor, errorListener: GlShaderProgram.ErrorListener) {
    this.errorExecutor = executor
    this.errorListener = errorListener
  }

  private fun freeCount() = max(0, CAPACITY - outputs.count { it.inUse } - retired.size)

  override fun queueInputFrame(glObjectsProvider: GlObjectsProvider, inputTexture: GlTextureInfo, presentationTimeUs: Long) {
    var handedBack = false
    try {
      val s = settings.snapshot()
      val w = inputTexture.width
      val h = inputTexture.height
      val size = if (s.upscale && !useHdr) UpscaleSize.forView(w, h, s.viewWidth, s.viewHeight) else intArrayOf(w, h)
      ensureOutputs(size[0], size[1])
      val out = outputs.firstOrNull { !it.inUse } ?: throw IllegalStateException("No free output frame")
      render(inputTexture, out.tex, s)
      inputListener.onInputFrameProcessed(inputTexture)
      handedBack = true
      out.inUse = true
      stats?.let {
        it.upscaleInWidth = w
        it.upscaleInHeight = h
        it.upscaleOutWidth = size[0]
        it.upscaleOutHeight = size[1]
      }
      outputListener.onOutputFrameAvailable(out.info, presentationTimeUs)
    } catch (e: Exception) {
      if (!handedBack) inputListener.onInputFrameProcessed(inputTexture)
      fail(e)
    }
  }

  private fun render(input: GlTextureInfo, target: GlTex, s: MemcSettings.Snapshot) {
    val p = programs ?: Programs().also { programs = it }
    val split = if (s.compare) s.split.coerceIn(0f, 1f) else -1f
    val lineW = 1.5f / max(1, target.width)
    val sharp = if (s.upscale && !useHdr) s.sharpness.coerceIn(0f, 1f) else 0f
    val scaling = target.width != input.width || target.height != input.height
    if (scaling) {
      val m = mid?.takeIf { it.width == target.width && it.height == target.height }
        ?: run {
          mid?.delete()
          GlKit.target(target.width, target.height, GLES30.GL_RGBA8).also { mid = it }
        }
      p.upscale.use()
      p.upscale.tex("uSrc", 0, input.texId)
      p.upscale.f2("uSrcSize", input.width.toFloat(), input.height.toFloat())
      p.upscale.f("uSplit", split)
      GlKit.drawTo(m)
      sharpen(p, m.id, target, sharp, split, lineW)
    } else {
      mid?.delete()
      mid = null
      p.copy.use()
      p.copy.tex("uSrc", 0, input.texId)
      GlKit.drawTo(target)
    }
  }

  private fun sharpen(p: Programs, src: Int, target: GlTex, sharp: Float, split: Float, lineW: Float) {
    p.sharpen.use()
    p.sharpen.tex("uSrc", 0, src)
    p.sharpen.f("uSharp", sharp)
    p.sharpen.f("uSplit", split)
    p.sharpen.f("uLineW", lineW)
    GlKit.drawTo(target)
  }

  private fun ensureOutputs(w: Int, h: Int) {
    if (outputs.isNotEmpty() && outputs[0].tex.width == w && outputs[0].tex.height == h) return
    for (o in outputs) if (o.inUse) retired += o else o.tex.delete()
    outputs.clear()
    val format = if (useHdr) GLES30.GL_RGBA16F else GLES30.GL_RGBA8
    repeat(CAPACITY) {
      val tex = GlKit.target(w, h, format)
      outputs += Output(tex, GlTextureInfo(tex.id, tex.fbo, C.INDEX_UNSET, w, h))
    }
  }

  override fun releaseOutputFrame(outputTexture: GlTextureInfo) {
    val old = retired.firstOrNull { it.info === outputTexture || it.info.texId == outputTexture.texId }
    if (old != null) {
      retired.remove(old)
      old.tex.delete()
      inputListener.onReadyToAcceptInputFrame()
      return
    }
    val out = outputs.firstOrNull { it.info.texId == outputTexture.texId } ?: return
    if (!out.inUse) return
    out.inUse = false
    inputListener.onReadyToAcceptInputFrame()
  }

  override fun signalEndOfCurrentInputStream() {
    outputListener.onCurrentOutputStreamEnded()
  }

  override fun flush() {
    outputs.forEach { it.inUse = false }
    retired.forEach { it.tex.delete() }
    retired.clear()
    inputListener.onFlush()
    repeat(freeCount()) { inputListener.onReadyToAcceptInputFrame() }
  }

  override fun release() {
    try {
      programs?.delete()
      programs = null
      mid?.delete()
      mid = null
      outputs.forEach { it.tex.delete() }
      outputs.clear()
      retired.forEach { it.tex.delete() }
      retired.clear()
    } catch (e: Exception) {
      throw VideoFrameProcessingException(e)
    }
  }

  private fun fail(e: Exception) {
    val listener = errorListener ?: return
    errorExecutor.execute { listener.onError(VideoFrameProcessingException.from(e)) }
  }

  private companion object {
    /** Frames that can be on their way to the screen at once. */
    const val CAPACITY = 3
  }
}

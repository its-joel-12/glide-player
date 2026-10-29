package expo.modules.glide.memc

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
import java.util.concurrent.Executor
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.roundToLong

/**
 * Frame-rate conversion as a Media3 video effect. The same effect runs inside ExoPlayer
 * (live playback) and inside Transformer (saving a smoothed or slow-motion copy).
 */
@OptIn(UnstableApi::class)
internal class MemcEffect(
  private val settings: MemcSettings,
  private val stats: MemcStats?,
  private val isExport: Boolean,
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram =
    MemcShaderProgram(settings, stats, useHdr, isExport)
}

/**
 * For every new source frame B (after frame A) it emits the in-between frames on a regular
 * output grid (A, B), then B itself, so timestamps always increase. It accepts one input frame
 * at a time and only asks for the next once everything for the current one has been handed
 * downstream, which keeps frames A and B alive while they're still needed.
 */
@OptIn(UnstableApi::class)
internal class MemcShaderProgram(
  private val settings: MemcSettings,
  private val stats: MemcStats?,
  private val useHdr: Boolean,
  private val isExport: Boolean,
) : GlShaderProgram {

  private class Output(val tex: GlTex, val info: GlTextureInfo) {
    var inUse = false
  }

  private class Job(val a: Frame, val b: Frame, val t: Float, val timeUs: Long, val original: Boolean)

  private var inputListener: GlShaderProgram.InputListener = object : GlShaderProgram.InputListener {}
  private var outputListener: GlShaderProgram.OutputListener = object : GlShaderProgram.OutputListener {}
  private var errorListener: GlShaderProgram.ErrorListener? = null
  private var errorExecutor: Executor = Executor { it.run() }

  private val engine = MotionEngine(useHdr)
  private val outputs = ArrayList<Output>()
  /** Old-size outputs still held downstream after a resolution change; deleted once released. */
  private val retired = ArrayList<Output>()
  private val pending = ArrayDeque<Job>()
  private var previous: Frame? = null
  private var readySignalled = false
  private var draining = false
  private var endPending = false

  override fun setInputListener(inputListener: GlShaderProgram.InputListener) {
    this.inputListener = inputListener
    readySignalled = false
    signalReady()
  }

  override fun setOutputListener(outputListener: GlShaderProgram.OutputListener) {
    this.outputListener = outputListener
  }

  override fun setErrorListener(executor: Executor, errorListener: GlShaderProgram.ErrorListener) {
    this.errorExecutor = executor
    this.errorListener = errorListener
  }

  override fun queueInputFrame(glObjectsProvider: GlObjectsProvider, inputTexture: GlTextureInfo, presentationTimeUs: Long) {
    readySignalled = false
    var handedBack = false
    try {
      val s = settings.snapshot()
      val w = inputTexture.width
      val h = inputTexture.height
      if (engine.configure(w, h, s.quality)) previous = null
      ensureOutputs(w, h)

      val a = previous
      val b = engine.ingest(inputTexture.texId, presentationTimeUs, a)
      inputListener.onInputFrameProcessed(inputTexture)
      handedBack = true
      stats?.onInput()

      val small = w.toLong() * h <= MAX_INTERPOLATED_PIXELS
      if (a != null && s.mode != MemcSettings.MODE_OFF && small) {
        val gap = presentationTimeUs - a.timeUs
        if (gap in 1..s.maxGapUs) {
          val motion = s.mode == MemcSettings.MODE_MEMC && engine.motionSupported
          if (motion) engine.estimate(a, b)
          stats?.motionActive = motion
          scheduleInBetween(a, b, s)
        }
      } else {
        stats?.motionActive = false
      }
      pending.addLast(Job(b, b, 0f, presentationTimeUs, original = true))
      previous = b
    } catch (e: Exception) {
      if (!handedBack) inputListener.onInputFrameProcessed(inputTexture)
      previous = null
      fail(e)
    }
    drain()
  }

  /** Adds jobs for output-grid times strictly between [a] and [b], keeping half a step clear of both. */
  private fun scheduleInBetween(a: Frame, b: Frame, s: MemcSettings.Snapshot) {
    val gap = (b.timeUs - a.timeUs).toDouble()
    val step = 1_000_000.0 * max(0.05f, s.speed) / max(1f, s.targetFps)
    if (step >= gap * 0.75) return
    var k = ceil((a.timeUs + step * 0.5) / step).toLong()
    var made = 0
    while (made < MAX_IN_BETWEEN) {
      val tau = (k * step).roundToLong()
      if (tau >= b.timeUs - step * 0.5) break
      if (tau > a.timeUs) {
        pending.addLast(Job(a, b, ((tau - a.timeUs) / gap).toFloat(), tau, original = false))
        made++
      }
      k++
    }
  }

  private fun drain() {
    if (draining) return
    draining = true
    try {
      while (pending.isNotEmpty()) {
        val out = outputs.firstOrNull { !it.inUse } ?: break
        val job = pending.removeFirst()
        renderJob(out, job)
        out.inUse = true
        outputListener.onOutputFrameAvailable(out.info, job.timeUs)
        stats?.onOutput(generated = !job.original)
      }
    } catch (e: Exception) {
      pending.clear()
      fail(e)
    } finally {
      draining = false
    }
    if (pending.isEmpty()) {
      if (endPending) {
        endPending = false
        outputListener.onCurrentOutputStreamEnded()
      }
      signalReady()
    }
  }

  private fun renderJob(out: Output, job: Job) {
    val s = settings.snapshot()
    val split = if (s.compare && !isExport) s.split.coerceIn(0f, 1f) else -1f
    val vectors = s.showVectors && !isExport
    if (job.original) {
      val showVectors = vectors && job.b.fieldsFrom >= 0
      engine.render(out.tex, job.b, job.b, 0f, MemcSettings.MODE_OFF, showVectors, split, showVectors)
    } else {
      val fields = s.mode == MemcSettings.MODE_MEMC && engine.motionSupported && job.b.hasFieldsFrom(job.a)
      val mode = if (fields) MemcSettings.MODE_MEMC else MemcSettings.MODE_BLEND
      engine.render(out.tex, job.a, job.b, job.t, mode, fields, split, vectors && fields)
    }
  }

  private fun ensureOutputs(w: Int, h: Int) {
    if (outputs.isNotEmpty() && outputs[0].tex.width == w && outputs[0].tex.height == h) return
    for (o in outputs) if (o.inUse) retired += o else o.tex.delete()
    outputs.clear()
    val bytesPerFrame = w.toLong() * h * (if (useHdr) 8 else 4)
    val count = if (isExport) 4 else (POOL_BUDGET_BYTES / bytesPerFrame).toInt().coerceIn(4, 12)
    val format = if (useHdr) GLES30.GL_RGBA16F else GLES30.GL_RGBA8
    repeat(count) {
      val tex = GlKit.target(w, h, format)
      outputs += Output(tex, GlTextureInfo(tex.id, tex.fbo, C.INDEX_UNSET, w, h))
    }
  }

  private fun signalReady() {
    if (readySignalled) return
    readySignalled = true
    inputListener.onReadyToAcceptInputFrame()
  }

  override fun releaseOutputFrame(outputTexture: GlTextureInfo) {
    val old = retired.firstOrNull { it.info === outputTexture || it.info.texId == outputTexture.texId }
    if (old != null) {
      retired.remove(old)
      old.tex.delete()
      return
    }
    val out = outputs.firstOrNull { it.info.texId == outputTexture.texId } ?: return
    if (!out.inUse) return
    out.inUse = false
    drain()
  }

  override fun signalEndOfCurrentInputStream() {
    previous = null
    if (pending.isEmpty() && !draining) {
      outputListener.onCurrentOutputStreamEnded()
    } else {
      endPending = true
    }
  }

  override fun flush() {
    pending.clear()
    outputs.forEach { it.inUse = false }
    retired.forEach { it.tex.delete() }
    retired.clear()
    previous = null
    endPending = false
    inputListener.onFlush()
    readySignalled = false
    signalReady()
  }

  override fun release() {
    try {
      engine.release()
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
    /** Bigger than 4K is passed through unchanged. */
    const val MAX_INTERPOLATED_PIXELS = 3840L * 2160L
    const val MAX_IN_BETWEEN = 63
    const val POOL_BUDGET_BYTES = 128L * 1024 * 1024
  }
}

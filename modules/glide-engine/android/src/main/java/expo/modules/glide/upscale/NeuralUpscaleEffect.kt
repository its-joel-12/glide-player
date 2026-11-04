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
import expo.modules.glide.memc.GlFailure
import expo.modules.glide.memc.GlKit
import expo.modules.glide.memc.GlProg
import expo.modules.glide.memc.GlTex
import expo.modules.glide.memc.Shaders
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executor

/**
 * AI upscaling for saved copies (Transformer only; far too slow for playback). Every frame is read
 * back from the GPU, run through [NeuralUpscaler] (4×), uploaded again and area-averaged down to
 * the size asked for ([Shaders.RESAMPLE]). [onReady] reports whether the network runs on the GPU.
 */
@OptIn(UnstableApi::class)
internal class NeuralUpscaleEffect(
  private val factor: Int,
  private val onReady: (usesGpu: Boolean) -> Unit = {},
) : GlEffect {
  override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram {
    if (useHdr) throw VideoFrameProcessingException("HDR videos can't be AI-upscaled yet.")
    return NeuralUpscaleProgram(context.applicationContext, factor, onReady)
  }
}

@OptIn(UnstableApi::class)
internal class NeuralUpscaleProgram(
  private val context: Context,
  private val factor: Int,
  private val onReady: (Boolean) -> Unit,
) : GlShaderProgram {

  private class Output(val tex: GlTex, val info: GlTextureInfo) {
    var inUse = false
  }

  private var inputListener: GlShaderProgram.InputListener = object : GlShaderProgram.InputListener {}
  private var outputListener: GlShaderProgram.OutputListener = object : GlShaderProgram.OutputListener {}
  private var errorListener: GlShaderProgram.ErrorListener? = null
  private var errorExecutor: Executor = Executor { it.run() }

  private var upscaler: NeuralUpscaler? = null
  private var copy: GlProg? = null
  private var resample: GlProg? = null
  /** The input frame copied into a texture we can read back. */
  private var frame: GlTex? = null
  /** The network's 4× result, uploaded. */
  private var big: GlTex? = null
  private var readBuf: ByteBuffer? = null
  private var bigBuf: ByteBuffer? = null
  private val outputs = ArrayList<Output>()
  private val retired = ArrayList<Output>()

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

  private fun freeCount() = maxOf(0, CAPACITY - outputs.count { it.inUse } - retired.size)

  override fun queueInputFrame(glObjectsProvider: GlObjectsProvider, inputTexture: GlTextureInfo, presentationTimeUs: Long) {
    var handedBack = false
    try {
      val w = inputTexture.width
      val h = inputTexture.height
      if (!NeuralPlan.canUpscale(w, h)) {
        throw GlFailure("AI upscaling works on videos up to ${NeuralPlan.MAX_INPUT_LONG}×${NeuralPlan.MAX_INPUT_SHORT}; this one is ${w}×$h.")
      }
      val size = NeuralPlan.outputSize(w, h, factor) ?: intArrayOf(w, h)
      val net = upscaler ?: NeuralUpscaler(context).also {
        upscaler = it
        onReady(it.usesGpu)
      }
      val cp = copy ?: GlProg(Shaders.VERTEX, Shaders.COPY).also { copy = it }
      val rs = resample ?: GlProg(Shaders.VERTEX, Shaders.RESAMPLE).also { resample = it }

      // 1. Copy the frame into our own texture and read it back.
      val f = frame?.takeIf { it.width == w && it.height == h } ?: run {
        frame?.delete()
        GlKit.target(w, h, GLES30.GL_RGBA8).also { frame = it }
      }
      cp.use()
      cp.tex("uSrc", 0, inputTexture.texId)
      GlKit.drawTo(f)
      inputListener.onInputFrameProcessed(inputTexture)
      handedBack = true
      val read = buffer(readBuf, w * h * 4).also { readBuf = it }
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, f.fbo)
      GLES30.glPixelStorei(GLES30.GL_PACK_ALIGNMENT, 1)
      read.rewind()
      GLES30.glReadPixels(0, 0, w, h, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, read)
      GLES30.glPixelStorei(GLES30.GL_PACK_ALIGNMENT, 4)
      GlKit.check("Reading the frame")

      // 2. The network (blocks this thread while the worker runs it).
      val s = NeuralPlan.MODEL_SCALE
      val bw = w * s
      val bh = h * s
      val result = buffer(bigBuf, bw * bh * 4).also { bigBuf = it }
      net.upscale(read, w, h, result)

      // 3. Upload and bring it to the size asked for.
      val b = big?.takeIf { it.width == bw && it.height == bh } ?: run {
        big?.delete()
        val max = IntArray(1)
        GLES30.glGetIntegerv(GLES30.GL_MAX_TEXTURE_SIZE, max, 0)
        if (bw > max[0] || bh > max[0]) throw GlFailure("This phone's GPU can't hold a ${bw}×$bh picture (limit ${max[0]}).")
        GlKit.target(bw, bh, GLES30.GL_RGBA8).also { big = it }
      }
      GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, b.id)
      GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 1)
      result.rewind()
      GLES30.glTexSubImage2D(GLES30.GL_TEXTURE_2D, 0, 0, 0, bw, bh, GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, result)
      GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 4)
      GlKit.check("Uploading the upscaled frame")

      ensureOutputs(size[0], size[1])
      val out = outputs.firstOrNull { !it.inUse } ?: throw IllegalStateException("No free output frame")
      if (size[0] == bw && size[1] == bh) {
        cp.use()
        cp.tex("uSrc", 0, b.id)
      } else {
        rs.use()
        rs.tex("uSrc", 0, b.id)
        rs.f2("uFootprint", 1f / size[0], 1f / size[1])
      }
      GlKit.drawTo(out.tex)
      out.inUse = true
      outputListener.onOutputFrameAvailable(out.info, presentationTimeUs)
    } catch (e: Throwable) {
      if (!handedBack) inputListener.onInputFrameProcessed(inputTexture)
      fail(e)
    }
  }

  private fun buffer(current: ByteBuffer?, bytes: Int): ByteBuffer =
    current?.takeIf { it.capacity() == bytes } ?: ByteBuffer.allocateDirect(bytes).order(ByteOrder.nativeOrder())

  private fun ensureOutputs(w: Int, h: Int) {
    if (outputs.isNotEmpty() && outputs[0].tex.width == w && outputs[0].tex.height == h) return
    for (o in outputs) if (o.inUse) retired += o else o.tex.delete()
    outputs.clear()
    repeat(CAPACITY) {
      val tex = GlKit.target(w, h, GLES30.GL_RGBA8)
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
      upscaler?.close()
      upscaler = null
      copy?.delete()
      resample?.delete()
      copy = null
      resample = null
      frame?.delete()
      big?.delete()
      frame = null
      big = null
      readBuf = null
      bigBuf = null
      outputs.forEach { it.tex.delete() }
      outputs.clear()
      retired.forEach { it.tex.delete() }
      retired.clear()
    } catch (e: Exception) {
      throw VideoFrameProcessingException(e)
    }
  }

  private fun fail(e: Throwable) {
    val listener = errorListener ?: return
    val ex = if (e is Exception) e else RuntimeException(e.message ?: e.javaClass.simpleName, e)
    errorExecutor.execute { listener.onError(VideoFrameProcessingException.from(ex)) }
  }

  private companion object {
    const val CAPACITY = 2
  }
}

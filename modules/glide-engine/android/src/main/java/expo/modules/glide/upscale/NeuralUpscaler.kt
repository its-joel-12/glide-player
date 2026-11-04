package expo.modules.glide.upscale

import android.content.Context
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.CompatibilityList
import org.tensorflow.lite.gpu.GpuDelegate
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Sizes shared with the app (src/lib/upscale-plan.ts mirrors these; tests check they match). */
internal object NeuralPlan {
  /** The network makes pictures this many times bigger. */
  const val MODEL_SCALE = 4
  /** Model input is TILE×TILE pixels; PAD of them on each side are context only, CORE in the middle is kept. */
  const val TILE = 192
  const val PAD = 12
  const val CORE = TILE - 2 * PAD
  /** Largest video the network is run on (long and short side). */
  const val MAX_INPUT_LONG = 1280
  const val MAX_INPUT_SHORT = 720
  /** Largest saved copy (long and short side). */
  const val MAX_OUTPUT_LONG = 3840
  const val MAX_OUTPUT_SHORT = 2160
  /** Below this it isn't worth it. */
  const val MIN_GAIN = 1.25f

  fun canUpscale(w: Int, h: Int) = max(w, h) <= MAX_INPUT_LONG && min(w, h) <= MAX_INPUT_SHORT

  /** Size of the saved copy for [factor] (2 or 4), capped at 4K; null when it wouldn't get bigger. */
  fun outputSize(w: Int, h: Int, factor: Int): IntArray? {
    if (w <= 0 || h <= 0) return null
    val long = max(w, h).toFloat()
    val short = min(w, h).toFloat()
    val scale = minOf(factor.toFloat(), MAX_OUTPUT_LONG / long, MAX_OUTPUT_SHORT / short)
    if (scale < MIN_GAIN) return null
    return intArrayOf(even(w * scale), even(h * scale))
  }

  private fun even(v: Float) = max(2, v.roundToInt() and 1.inv())
}

/**
 * Super-resolution with a small neural network: Real-ESRGAN "realesr-general-x4v3"
 * (SRVGGNetCompact, BSD-3-Clause, by Xintao Wang et al.), converted to TensorFlow Lite with float16
 * weights (assets/glide-sr-x4.tflite, 2.5 MB). It makes every frame 4× bigger and rebuilds edges,
 * text and texture that plain resampling can't, and cleans up compression blocks on the way.
 *
 * Runs on the GPU through the TFLite GPU delegate when the phone supports it, otherwise on 4 CPU
 * threads. The network has a fixed 192×192 input, so frames are cut into overlapping tiles.
 * Everything runs on one worker thread (the GPU delegate must stay on the thread that made it);
 * [upscale] blocks the caller until the frame is done.
 */
internal class NeuralUpscaler(context: Context) : AutoCloseable {
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "glide-sr").apply { priority = Thread.NORM_PRIORITY } }
  private lateinit var interpreter: Interpreter
  private var gpu: GpuDelegate? = null
  private val outTile = NeuralPlan.TILE * NeuralPlan.MODEL_SCALE
  private val input: ByteBuffer = ByteBuffer.allocateDirect(4 * NeuralPlan.TILE * NeuralPlan.TILE * 3).order(ByteOrder.nativeOrder())
  private val output: ByteBuffer = ByteBuffer.allocateDirect(4 * outTile * outTile * 3).order(ByteOrder.nativeOrder())
  private var closed = false

  /** True when the network runs on the GPU. */
  var usesGpu = false
    private set

  init {
    val model = context.assets.open(MODEL_ASSET).use { stream ->
      val bytes = stream.readBytes()
      ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
        put(bytes)
        rewind()
      }
    }
    try {
      onWorker { setup(model) }
    } catch (e: Throwable) {
      worker.shutdown()
      throw e
    }
  }

  private fun setup(model: ByteBuffer) {
    var delegate: GpuDelegate? = null
    try {
      val compat = CompatibilityList()
      try {
        if (compat.isDelegateSupportedOnThisDevice) delegate = GpuDelegate(compat.bestOptionsForThisDevice)
      } finally {
        compat.close()
      }
    } catch (_: Throwable) {
      delegate = null
    }
    if (delegate != null) {
      try {
        interpreter = Interpreter(model, Interpreter.Options().addDelegate(delegate))
        gpu = delegate
        usesGpu = true
        return
      } catch (_: Throwable) {
        delegate.close()
      }
    }
    model.rewind()
    interpreter = Interpreter(model, Interpreter.Options().setNumThreads(CPU_THREADS))
  }

  /**
   * Upscales one RGBA frame. [src] is [w]×[h] RGBA8 rows bottom-up (as glReadPixels gives them);
   * [dst] gets the 4× picture in the same layout, alpha 255. Blocks until done.
   */
  fun upscale(src: ByteBuffer, w: Int, h: Int, dst: ByteBuffer) {
    val s = NeuralPlan.MODEL_SCALE
    require(dst.capacity() >= w * s * h * s * 4) { "Output buffer too small" }
    onWorker { runTiles(src, w, h, dst) }
  }

  private fun runTiles(src: ByteBuffer, w: Int, h: Int, dst: ByteBuffer) {
    val t = NeuralPlan.TILE
    val pad = NeuralPlan.PAD
    val core = NeuralPlan.CORE
    val s = NeuralPlan.MODEL_SCALE
    val dw = w * s
    val dh = h * s
    var y0 = 0
    while (y0 < h) {
      var x0 = 0
      while (x0 < w) {
        // Network input: the tile plus its margin, top row first, edges repeated outside the frame.
        var i = 0
        for (iy in 0 until t) {
          val sy = (y0 - pad + iy).coerceIn(0, h - 1)
          val row = (h - 1 - sy) * w
          for (ix in 0 until t) {
            val sx = (x0 - pad + ix).coerceIn(0, w - 1)
            val p = (row + sx) * 4
            input.putFloat(i, (src.get(p).toInt() and 0xFF) * INV_255)
            input.putFloat(i + 4, (src.get(p + 1).toInt() and 0xFF) * INV_255)
            input.putFloat(i + 8, (src.get(p + 2).toInt() and 0xFF) * INV_255)
            i += 12
          }
        }
        input.rewind()
        output.rewind()
        interpreter.run(input, output)
        // Keep the middle of the result (the margin only gave the network context).
        val cw = min(core, w - x0) * s
        val ch = min(core, h - y0) * s
        for (oy in 0 until ch) {
          val dy = y0 * s + oy
          val drow = (dh - 1 - dy) * dw
          var o = ((pad * s + oy) * outTile + pad * s) * 12
          var d = (drow + x0 * s) * 4
          for (ox in 0 until cw) {
            dst.put(d, channel(output.getFloat(o)))
            dst.put(d + 1, channel(output.getFloat(o + 4)))
            dst.put(d + 2, channel(output.getFloat(o + 8)))
            dst.put(d + 3, 0xFF.toByte())
            o += 12
            d += 4
          }
        }
        x0 += core
      }
      y0 += core
    }
  }

  private fun channel(v: Float): Byte = (v * 255f + 0.5f).toInt().coerceIn(0, 255).toByte()

  private fun onWorker(block: () -> Unit) {
    check(!closed) { "Upscaler is closed" }
    try {
      worker.submit(Callable { block() }).get()
    } catch (e: ExecutionException) {
      throw e.cause ?: e
    }
  }

  override fun close() {
    if (closed) return
    try {
      worker.submit(
        Callable {
          if (this::interpreter.isInitialized) interpreter.close()
          gpu?.close()
          gpu = null
        }
      ).get()
    } catch (_: Exception) {
    } finally {
      closed = true
      worker.shutdown()
    }
  }

  companion object {
    const val MODEL_ASSET = "glide-sr-x4.tflite"
    private const val CPU_THREADS = 4
    private const val INV_255 = 1f / 255f
  }
}

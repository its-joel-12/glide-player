package expo.modules.glide.memc

import android.opengl.GLES30
import kotlin.math.floor
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** A copied source frame with its luma pyramid and the motion fields that lead to it. */
internal class Frame(
  val color: GlTex,
  val pyramid: List<GlTex>,
  /** Motion from the previous frame to this one, one vector per block of the previous frame. */
  val forward: GlTex?,
  /** Motion from this frame back to the previous one, one vector per block of this frame. */
  val backward: GlTex?,
) {
  var timeUs = 0L
  var serial = 0L
  /** [serial] of the frame the fields were estimated against, or -1 when there are none. */
  var fieldsFrom = -1L

  fun hasFieldsFrom(previous: Frame) = forward != null && fieldsFrom == previous.serial

  fun delete() {
    color.delete()
    pyramid.forEach { it.delete() }
    forward?.delete()
    backward?.delete()
  }
}

/**
 * GPU motion estimation and frame interpolation. Must be used on one GL thread with a current
 * OpenGL ES 3 context (the Media3 video processing thread).
 *
 * Pipeline per new frame: copy → luma pyramid → hierarchical block matching in both directions
 * (coarse to fine, half-pixel at the finest level) → vector median. Rendering an in-between frame
 * then samples both frames along the motion paths.
 */
internal class MotionEngine(private val useHdr: Boolean) {
  private class Programs {
    val copy = GlProg(Shaders.VERTEX, Shaders.COPY)
    val luma = GlProg(Shaders.VERTEX, Shaders.LUMA)
    val motion = GlProg(Shaders.VERTEX, Shaders.MOTION)
    val median = GlProg(Shaders.VERTEX, Shaders.MEDIAN)
    val output = GlProg(Shaders.VERTEX, Shaders.OUTPUT)

    fun delete() {
      copy.delete(); luma.delete(); motion.delete(); median.delete(); output.delete()
    }
  }

  private data class Pass(val level: Int, val radius: Int, val step: Float, val lambda: Float)

  private var programs: Programs? = null
  private var slots: List<Frame> = emptyList()
  private var scratch: List<GlTex> = emptyList()
  private var nextSlot = 0
  private var serials = 0L
  private var levels: List<IntArray> = emptyList()
  private var plan: List<Pass> = emptyList()
  private var fieldWidth = 0
  private var fieldHeight = 0
  private var quality: Quality? = null

  var width = 0
    private set
  var height = 0
    private set

  /** False when this GPU can't draw into half-float textures; then only cross-fading is offered. */
  var motionSupported = true
    private set

  /** Sets up textures for [w]×[h] frames. Returns true when it had to (re)allocate, which drops history. */
  fun configure(w: Int, h: Int, q: Quality): Boolean {
    if (w == width && h == height && q == quality && slots.isNotEmpty()) return false
    releaseTextures()
    if (programs == null) programs = Programs()
    width = w
    height = h
    quality = q

    val scale = min(1f, q.longSide.toFloat() / max(w, h))
    var lw = max(16, (w * scale).roundToInt())
    var lh = max(16, (h * scale).roundToInt())
    val count = (1 + floor(log2(max(lw, lh) / 48f))).toInt().coerceIn(3, 5)
    val sizes = ArrayList<IntArray>()
    repeat(count) {
      sizes += intArrayOf(lw, lh)
      lw = max(4, (lw + 1) / 2)
      lh = max(4, (lh + 1) / 2)
    }
    levels = sizes
    fieldWidth = (sizes[0][0] + 7) / 8
    fieldHeight = (sizes[0][1] + 7) / 8

    val top = sizes.size - 1
    val passes = ArrayList<Pass>()
    passes += Pass(top, 4, 1f, 0.003f)
    for (l in top - 1 downTo 1) passes += Pass(l, 2, 1f, 0.003f)
    passes += Pass(0, 3, 0.5f, 0.002f)
    if (q.extraFinePass) passes += Pass(0, 2, 0.25f, 0.0015f)
    plan = passes

    var fields = motionSupported
    val temp = ArrayList<GlTex>()
    if (fields) {
      try {
        temp += GlKit.target(fieldWidth, fieldHeight, GLES30.GL_RGBA16F)
        temp += GlKit.target(fieldWidth, fieldHeight, GLES30.GL_RGBA16F)
      } catch (e: GlFailure) {
        temp.forEach { it.delete() }
        temp.clear()
        fields = false
      }
    }
    motionSupported = fields
    scratch = temp

    val colorFormat = if (useHdr) GLES30.GL_RGBA16F else GLES30.GL_RGBA8
    slots = List(3) {
      Frame(
        color = GlKit.target(w, h, colorFormat),
        pyramid = sizes.map { GlKit.target(it[0], it[1], GLES30.GL_R8) },
        forward = if (fields) GlKit.target(fieldWidth, fieldHeight, GLES30.GL_RGBA16F) else null,
        backward = if (fields) GlKit.target(fieldWidth, fieldHeight, GLES30.GL_RGBA16F) else null,
      )
    }
    nextSlot = 0
    return true
  }

  /** Copies [inputTexId] into a free slot (never the one holding [keep]) and builds its pyramid. */
  fun ingest(inputTexId: Int, timeUs: Long, keep: Frame?): Frame {
    val p = programs ?: throw GlFailure("Motion engine is not configured")
    var slot = slots[nextSlot]
    if (slot === keep) {
      nextSlot = (nextSlot + 1) % slots.size
      slot = slots[nextSlot]
    }
    nextSlot = (nextSlot + 1) % slots.size

    p.copy.use()
    p.copy.tex("uSrc", 0, inputTexId)
    GlKit.drawTo(slot.color)

    p.luma.use()
    for (k in slot.pyramid.indices) {
      val dst = slot.pyramid[k]
      p.luma.tex("uSrc", 0, if (k == 0) slot.color.id else slot.pyramid[k - 1].id)
      p.luma.f2("uDT", 1f / dst.width, 1f / dst.height)
      p.luma.i("uIsLuma", if (k == 0) 0 else 1)
      GlKit.drawTo(dst)
    }
    slot.timeUs = timeUs
    slot.serial = ++serials
    slot.fieldsFrom = -1
    return slot
  }

  /** Estimates motion between [a] (earlier) and [b] in both directions and stores it on [b]. */
  fun estimate(a: Frame, b: Frame) {
    if (!motionSupported) return
    val p = programs ?: return
    val forward = b.forward ?: return
    val backward = b.backward ?: return
    for (dir in 0..1) {
      val from = if (dir == 0) a else b
      val to = if (dir == 0) b else a
      val temporal = if (a.fieldsFrom >= 0) (if (dir == 0) a.forward else a.backward) else null
      var k = 0
      var hasPrev = false
      p.motion.use()
      for (pass in plan) {
        val out = scratch[k]
        val other = scratch[1 - k]
        val size = levels[pass.level]
        p.motion.tex("uA", 0, from.pyramid[pass.level].id)
        p.motion.tex("uB", 1, to.pyramid[pass.level].id)
        p.motion.tex("uPrev", 2, other.id)
        p.motion.tex("uTemp", 3, (temporal ?: other).id)
        p.motion.f2("uLT", 1f / size[0], 1f / size[1])
        p.motion.f2("uFT", 1f / fieldWidth, 1f / fieldHeight)
        p.motion.i("uR", pass.radius)
        p.motion.f("uStep", pass.step)
        p.motion.f("uLambda", pass.lambda)
        p.motion.i("uHasPrev", if (hasPrev) 1 else 0)
        p.motion.i("uHasTemp", if (temporal != null) 1 else 0)
        GlKit.drawTo(out)
        hasPrev = true
        k = 1 - k
      }
      p.median.use()
      p.median.tex("uF", 0, scratch[1 - k].id)
      p.median.f2("uFT", 1f / fieldWidth, 1f / fieldHeight)
      GlKit.drawTo(if (dir == 0) forward else backward)
    }
    b.fieldsFrom = a.serial
  }

  /**
   * Draws the picture at time [t] (0 = [a], 1 = [b]) into [target].
   * [mode]: MemcSettings.MODE_*. [useFields]: whether [b] holds motion from [a].
   * [split] < 0 means no split view; otherwise the left part shows [a] unprocessed.
   */
  fun render(target: GlTex, a: Frame, b: Frame, t: Float, mode: Int, useFields: Boolean, split: Float, vectors: Boolean) {
    val p = programs ?: return
    val o = p.output
    o.use()
    o.tex("uA", 0, a.color.id)
    o.tex("uB", 1, b.color.id)
    val f = if (useFields) b.forward else null
    val w = if (useFields) b.backward else null
    o.tex("uF", 2, f?.id ?: a.color.id)
    o.tex("uW", 3, w?.id ?: a.color.id)
    o.f("uT", t)
    o.i("uMode", mode)
    o.i("uHasF", if (f != null && w != null) 1 else 0)
    o.f("uSplit", split)
    o.i("uVec", if (vectors) 1 else 0)
    o.f2("uRes", width.toFloat(), height.toFloat())
    o.f("uLineW", 1.5f / max(1, target.width))
    o.f("uFlowMax", width * 0.03f)
    GlKit.drawTo(target)
  }

  private fun releaseTextures() {
    slots.forEach { it.delete() }
    slots = emptyList()
    scratch.forEach { it.delete() }
    scratch = emptyList()
    width = 0
    height = 0
  }

  fun release() {
    releaseTextures()
    programs?.delete()
    programs = null
  }
}

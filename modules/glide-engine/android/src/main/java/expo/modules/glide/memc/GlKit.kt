package expo.modules.glide.memc

import android.opengl.GLES30
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

internal class GlFailure(message: String) : Exception(message)

/** A texture with its own framebuffer, so it can be drawn into and sampled later. */
internal class GlTex(val id: Int, val fbo: Int, val width: Int, val height: Int) {
  fun delete() {
    GLES30.glDeleteFramebuffers(1, intArrayOf(fbo), 0)
    GLES30.glDeleteTextures(1, intArrayOf(id), 0)
  }
}

/** A linked shader program with cached uniform locations. Missing uniforms are ignored (location -1). */
internal class GlProg(vertex: String, fragment: String) {
  val id: Int
  private val locations = HashMap<String, Int>()

  init {
    val vs = compile(GLES30.GL_VERTEX_SHADER, vertex)
    val fs = compile(GLES30.GL_FRAGMENT_SHADER, fragment)
    id = GLES30.glCreateProgram()
    GLES30.glAttachShader(id, vs)
    GLES30.glAttachShader(id, fs)
    GLES30.glBindAttribLocation(id, 0, "aPos")
    GLES30.glLinkProgram(id)
    val status = IntArray(1)
    GLES30.glGetProgramiv(id, GLES30.GL_LINK_STATUS, status, 0)
    GLES30.glDeleteShader(vs)
    GLES30.glDeleteShader(fs)
    if (status[0] == 0) {
      val log = GLES30.glGetProgramInfoLog(id)
      GLES30.glDeleteProgram(id)
      throw GlFailure("Shader link failed: $log")
    }
  }

  private fun compile(type: Int, source: String): Int {
    val shader = GLES30.glCreateShader(type)
    GLES30.glShaderSource(shader, source)
    GLES30.glCompileShader(shader)
    val status = IntArray(1)
    GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
    if (status[0] == 0) {
      val log = GLES30.glGetShaderInfoLog(shader)
      GLES30.glDeleteShader(shader)
      throw GlFailure("Shader compile failed: $log")
    }
    return shader
  }

  fun use() = GLES30.glUseProgram(id)

  private fun loc(name: String): Int = locations.getOrPut(name) { GLES30.glGetUniformLocation(id, name) }

  fun i(name: String, value: Int) = GLES30.glUniform1i(loc(name), value)

  fun f(name: String, value: Float) = GLES30.glUniform1f(loc(name), value)

  fun f2(name: String, x: Float, y: Float) = GLES30.glUniform2f(loc(name), x, y)

  fun tex(name: String, unit: Int, textureId: Int) {
    GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + unit)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, textureId)
    GLES30.glUniform1i(loc(name), unit)
  }

  fun delete() = GLES30.glDeleteProgram(id)
}

internal object GlKit {
  /** One triangle that covers the whole viewport. Client-side memory, like Media3's own programs. */
  private val triangle: FloatBuffer =
    ByteBuffer.allocateDirect(6 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
      put(floatArrayOf(-1f, -1f, 3f, -1f, -1f, 3f))
      position(0)
    }

  /** Creates a texture of [internalFormat] (e.g. GL_RGBA8, GL_R8, GL_RGBA16F) with a framebuffer. */
  fun target(width: Int, height: Int, internalFormat: Int): GlTex {
    clearErrors()
    val tex = IntArray(1)
    GLES30.glGenTextures(1, tex, 0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, tex[0])
    GLES30.glTexStorage2D(GLES30.GL_TEXTURE_2D, 1, internalFormat, width, height)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    val fbo = IntArray(1)
    GLES30.glGenFramebuffers(1, fbo, 0)
    GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, fbo[0])
    GLES30.glFramebufferTexture2D(GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, tex[0], 0)
    val status = GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER)
    GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
    val error = GLES30.glGetError()
    if (status != GLES30.GL_FRAMEBUFFER_COMPLETE || error != GLES30.GL_NO_ERROR) {
      GLES30.glDeleteFramebuffers(1, fbo, 0)
      GLES30.glDeleteTextures(1, tex, 0)
      throw GlFailure(
        "Can't draw into a ${width}x$height texture (format 0x${Integer.toHexString(internalFormat)}, " +
          "status 0x${Integer.toHexString(status)}, error 0x${Integer.toHexString(error)})"
      )
    }
    return GlTex(tex[0], fbo[0], width, height)
  }

  /** Runs the program in use over the whole of [target]. */
  fun drawTo(target: GlTex) {
    GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, target.fbo)
    GLES30.glViewport(0, 0, target.width, target.height)
    GLES30.glDisable(GLES30.GL_BLEND)
    GLES30.glDisable(GLES30.GL_DEPTH_TEST)
    GLES30.glDisable(GLES30.GL_SCISSOR_TEST)
    GLES30.glBindVertexArray(0)
    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, 0)
    GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 0, triangle)
    GLES30.glEnableVertexAttribArray(0)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)
    GLES30.glDisableVertexAttribArray(0)
  }

  fun clearErrors() {
    var guard = 0
    while (GLES30.glGetError() != GLES30.GL_NO_ERROR && guard++ < 16) Unit
  }

  fun check(where: String) {
    val error = GLES30.glGetError()
    if (error != GLES30.GL_NO_ERROR) throw GlFailure("$where: GL error 0x${Integer.toHexString(error)}")
  }
}

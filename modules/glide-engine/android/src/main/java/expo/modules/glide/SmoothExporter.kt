package expo.modules.glide

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.StatFs
import android.provider.MediaStore
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import expo.modules.glide.memc.MemcEffect
import expo.modules.glide.memc.MemcSettings
import expo.modules.glide.memc.Quality
import expo.modules.glide.upscale.NeuralPlan
import expo.modules.glide.upscale.NeuralUpscaleEffect
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Also makes seekable copies (see [ExportOptions.remux]).
 *
 * Saves a smoothed (higher frame rate) or slow-motion copy of a video, like an optical-flow
 * retime in an editor. Uses the same motion engine as playback, with the slower, more detailed
 * analysis, and isn't limited to real time. Must be used on the main thread.
 */
@OptIn(UnstableApi::class)
internal class SmoothExporter(
  private val context: Context,
  private val onProgress: (Int) -> Unit,
  /** A seekable copy found damaged data at this time (ms); answer with [answerDamaged]. */
  private val onDamaged: (positionMs: Long) -> Unit,
) {
  private var transformer: Transformer? = null
  private var remuxer: Remuxer? = null
  private var promise: Promise? = null
  private var output: File? = null
  private var displayName = "glide.mp4"
  /** Seekable copies can be as big as a whole film: don't keep a second copy in the cache. */
  private var dropCacheCopy = false
  private val handler = Handler(Looper.getMainLooper())
  /** The user's answer to "the file is damaged, continue?" (true = skip damaged parts). */
  private val damagedAnswers = LinkedBlockingQueue<Boolean>()
  private val progress = ProgressHolder()
  /** AI upscaling: whether the network ran on the GPU (null = not used / not started). Set on the GL thread. */
  @Volatile private var aiOnGpu: Boolean? = null

  private companion object {
    /** Frame rate assumed for the bitrate of upscaled copies that keep the original rate. */
    const val ASSUMED_SOURCE_FPS = 30
  }

  private class ConstantSpeed(private val speed: Float) : SpeedProvider {
    override fun getSpeed(timeUs: Long): Float = speed
    override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
  }

  fun start(opts: ExportOptions, promise: Promise) {
    if (transformer != null || remuxer != null) {
      promise.reject("BUSY", "A video is already being saved. Wait for it to finish or cancel it.", null)
      return
    }
    if (opts.uri.isEmpty()) {
      promise.reject("NO_VIDEO", "No video was given.", null)
      return
    }
    if (opts.remux) {
      startRemux(opts, promise)
      return
    }
    val slow = opts.slowMotion.coerceIn(1, 8)
    // fps 0: keep the original frame rate, no smoothing (an upscaled copy only).
    val smooth = opts.fps > 0 || slow > 1
    val fps = if (smooth) opts.fps.coerceIn(24, 240) else 0
    val ai = opts.upscale.coerceIn(1, 4).let { if (it >= 3) 4 else it }
    var outW = opts.width.coerceIn(160, 7680)
    var outH = opts.height.coerceIn(120, 4320)
    if (ai > 1) {
      if (!NeuralPlan.canUpscale(opts.width, opts.height)) {
        promise.reject(
          "TOO_BIG",
          "AI upscaling is for videos up to ${NeuralPlan.MAX_INPUT_LONG}×${NeuralPlan.MAX_INPUT_SHORT} (720p); this one is already ${opts.width}×${opts.height}.",
          null,
        )
        return
      }
      val size = NeuralPlan.outputSize(opts.width, opts.height, ai)
      if (size == null) {
        promise.reject("TOO_BIG", "This video is already as big as a saved copy can be (4K).", null)
        return
      }
      outW = size[0]
      outH = size[1]
    } else if (!smooth) {
      promise.reject("NOTHING_TO_DO", "Choose smoothing, slow motion or upscaling.", null)
      return
    }
    val effects = ArrayList<androidx.media3.common.Effect>()
    // Upscale first (once per real frame), then make the in-between frames from the sharper picture.
    aiOnGpu = null
    if (ai > 1) effects += NeuralUpscaleEffect(ai) { gpu -> aiOnGpu = gpu }
    if (smooth) {
      val settings = MemcSettings().apply {
        mode = MemcSettings.MODE_MEMC
        targetFps = fps.toFloat()
        speed = 1f
        quality = Quality.from(opts.quality)
        compare = false
        showVectors = false
        maxGapUs = 250_000L * slow
      }
      effects += MemcEffect(settings, null, isExport = true)
    }
    val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(opts.uri)))
      .setEffects(Effects(emptyList(), effects))
    if (slow > 1) item.setSpeed(ConstantSpeed(1f / slow))
    if (!opts.keepAudio) item.setRemoveAudio(true)

    val parts = ArrayList<String>()
    if (ai > 1) parts += "ai${ai}x-${minOf(outW, outH)}p"
    if (slow > 1) parts += "slowmo-${slow}x-${fps}fps" else if (smooth) parts += "smooth-${fps}fps"
    displayName = "${baseName(opts.title)}-${parts.joinToString("-")}.mp4"
    dropCacheCopy = false
    val out = outputFile(displayName)

    // The default bitrate follows the source frame rate; a 4× faster copy needs about 4× the bits.
    val pixels = outW.toLong() * outH
    val rate = if (smooth) fps else ASSUMED_SOURCE_FPS
    val bitrate = (pixels * rate * 0.12).toLong().coerceIn(4_000_000L, 120_000_000L).toInt()
    val encoders = DefaultEncoderFactory.Builder(context)
      .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
      .build()
    val builder = Transformer.Builder(context)
      .setEncoderFactory(encoders)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .addListener(listener)
    // The network can take seconds per frame: don't let the muxer give up waiting for video.
    if (ai > 1) builder.setMaxDelayBetweenMuxerSamplesMs(C.TIME_UNSET)
    val t = builder.build()
    run(t, item.build(), out, promise)
  }

  /**
   * Rewrites the video into an MP4 with a seek index, keeping all audio tracks and the text
   * subtitles ([Remuxer]). If the picture's format can't go into MP4 as it is, falls back to
   * Transformer, which re-encodes it (one audio track, no subtitles).
   */
  private fun startRemux(opts: ExportOptions, promise: Promise) {
    val uri = Uri.parse(opts.uri)
    // Peak use: the new file in the cache plus its copy in the gallery, each about the original's size.
    val size = sourceSize(uri)
    val free = StatFs(context.cacheDir.path).availableBytes
    if (size > 0 && free < size * 2 + 300_000_000L) {
      val needGb = (size * 2 + 300_000_000L) / 1e9
      promise.reject("NO_SPACE", "Not enough free space: this needs about %.1f GB free while it works.".format(needGb), null)
      return
    }
    displayName = "${baseName(opts.title)}-seekable.mp4"
    dropCacheCopy = true
    val out = outputFile(displayName)
    val subtitleBase = "${System.currentTimeMillis()}-${displayName.removeSuffix(".mp4")}"
    damagedAnswers.clear()
    lateinit var r: Remuxer
    r = Remuxer(
      context, uri, out, File(context.filesDir, "subtitles"), subtitleBase, opts.keepAudio,
      onProgress = { p -> handler.post { onProgress(p) } }, // called on the worker thread
      onDamaged = { timeUs ->
        // Ask the user and wait on the worker thread (Cancel also ends the wait).
        handler.post { onDamaged(timeUs / 1000) }
        var answer: Boolean? = null
        while (answer == null) {
          if (r.cancelled) throw RemuxCancelled()
          answer = damagedAnswers.poll(250, TimeUnit.MILLISECONDS)
        }
        answer == true
      },
    )
    remuxer = r
    this.promise = promise
    this.output = out
    onProgress(0)
    Thread {
      try {
        val result = r.run()
        handler.post { if (remuxer === r) completeRemux(out, result) }
      } catch (e: UnsupportedVideoException) {
        out.delete()
        handler.post {
          if (remuxer !== r) return@post
          remuxer = null
          this.promise = null
          this.output = null
          startTransformerRemux(opts, uri, promise)
        }
      } catch (e: Throwable) {
        out.delete()
        handler.post {
          if (remuxer !== r) return@post
          remuxer = null
          this.promise = null
          this.output = null
          if (e is RemuxCancelled) promise.reject("CANCELLED", "Saving was cancelled.", null)
          else if (e is DamagedFileException) promise.reject("DAMAGED", e.message ?: "The file is damaged.", null)
          else promise.reject("EXPORT_FAILED", e.message ?: e.javaClass.simpleName, e)
        }
      }
    }.apply { name = "glide-remux" }.start()
  }

  private fun completeRemux(file: File, result: RemuxResult) {
    val p = promise ?: return
    val name = displayName
    remuxer = null
    promise = null
    output = null
    onProgress(100)
    Thread {
      val bytes = file.length()
      val saved = saveToGallery(file, name)
      if (saved != null) file.delete()
      p.resolve(
        mapOf(
          "uri" to (saved?.toString() ?: Uri.fromFile(file).toString()),
          "fileUri" to (if (saved != null) "" else Uri.fromFile(file).toString()),
          "savedToGallery" to (saved != null),
          "fileSizeBytes" to bytes.toDouble(),
          "name" to name,
          "subtitles" to result.subtitles.map {
            mapOf(
              "uri" to Uri.fromFile(it.file).toString(),
              "label" to it.label,
              "language" to (it.language ?: ""),
              "mimeType" to it.mimeType,
              "selected" to it.selected,
            )
          },
          "notes" to result.notes,
        )
      )
    }.start()
  }

  /** Re-encoding fallback (picture formats MP4 can't hold as they are). */
  private fun startTransformerRemux(opts: ExportOptions, uri: Uri, promise: Promise) {
    val item = EditedMediaItem.Builder(MediaItem.fromUri(uri))
    if (!opts.keepAudio) item.setRemoveAudio(true)
    // No effects and no forced codec: Transformer copies streams that MP4 can hold and converts the rest.
    val t = Transformer.Builder(context).addListener(listener).build()
    run(t, item.build(), outputFile(displayName), promise)
  }

  private fun baseName(title: String) =
    title.substringBeforeLast('.').replace(Regex("[^A-Za-z0-9 _-]"), "").trim().ifEmpty { "video" }.take(60)

  private fun outputFile(name: String): File {
    val dir = File(context.cacheDir, "exports").apply { mkdirs() }
    dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 86_400_000L) it.delete() }
    return File(dir, "${System.currentTimeMillis()}-$name")
  }

  private fun sourceSize(uri: Uri): Long =
    try {
      if (uri.scheme == "file" || uri.scheme == null) File(uri.path ?: "").length()
      else context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
    } catch (_: Exception) {
      -1L
    }

  private fun run(t: Transformer, item: EditedMediaItem, out: File, promise: Promise) {
    this.promise = promise
    this.output = out
    this.transformer = t
    try {
      t.start(item, out.absolutePath)
    } catch (e: Exception) {
      finish()
      promise.reject("EXPORT_FAILED", e.message ?: "Couldn't start saving the video.", e)
      return
    }
    onProgress(0)
    handler.post(poll)
  }

  private val poll = object : Runnable {
    override fun run() {
      val t = transformer ?: return
      if (t.getProgress(progress) == Transformer.PROGRESS_STATE_AVAILABLE) onProgress(progress.progress)
      handler.postDelayed(this, 300)
    }
  }

  private val listener = object : Transformer.Listener {
    override fun onCompleted(composition: Composition, exportResult: ExportResult) {
      val p = promise
      val file = output
      val name = displayName
      val dropCache = dropCacheCopy
      finish()
      if (p == null || file == null) return
      onProgress(100)
      // Copying into the gallery can take a moment for big files: keep it off the main thread.
      Thread {
        val bytes = if (exportResult.fileSizeBytes > 0) exportResult.fileSizeBytes else file.length()
        val saved = saveToGallery(file, name)
        if (saved != null && dropCache) file.delete()
        p.resolve(
          mapOf(
            "uri" to (saved?.toString() ?: Uri.fromFile(file).toString()),
            "fileUri" to (if (saved != null && dropCache) "" else Uri.fromFile(file).toString()),
            "savedToGallery" to (saved != null),
            "fileSizeBytes" to bytes.toDouble(),
            "name" to name,
            "notes" to (
              if (dropCache) listOf("The picture's format can't go into MP4 as it is, so it was converted. Only the main audio track was kept, and subtitles weren't copied.")
              else if (aiOnGpu == false) listOf("This phone's GPU couldn't run the upscaling network, so it ran on the processor (slower).")
              else emptyList()
            ),
          )
        )
      }.start()
    }

    override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
      val p = promise
      output?.delete()
      finish()
      p?.reject("EXPORT_FAILED", exportException.message ?: exportException.errorCodeName, exportException)
    }
  }

  /** The user's answer after [onDamaged]: true = skip the damaged parts and go on. */
  fun answerDamaged(keepGoing: Boolean) {
    damagedAnswers.offer(keepGoing)
  }

  fun cancel() {
    remuxer?.let { r ->
      // The worker thread stops at its next sample and rejects the promise.
      r.cancelled = true
      return
    }
    val t = transformer ?: return
    val p = promise
    t.cancel()
    output?.delete()
    finish()
    p?.reject("CANCELLED", "Saving was cancelled.", null)
  }

  private fun finish() {
    handler.removeCallbacks(poll)
    transformer = null
    promise = null
    output = null
  }

  /** Adds the file to Movies/Glide so it shows up in the gallery (Android 10+). Keeps the cache copy for sharing. */
  private fun saveToGallery(file: File, name: String): Uri? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Video.Media.DISPLAY_NAME, name)
      put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
      put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Glide")
      put(MediaStore.Video.Media.IS_PENDING, 1)
    }
    val uri = resolver.insert(MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values) ?: return null
    return try {
      resolver.openOutputStream(uri)?.use { out -> file.inputStream().use { it.copyTo(out) } } ?: throw IllegalStateException("No output stream")
      values.clear()
      values.put(MediaStore.Video.Media.IS_PENDING, 0)
      resolver.update(uri, values, null, null)
      uri
    } catch (e: Exception) {
      resolver.delete(uri, null, null)
      null
    }
  }
}

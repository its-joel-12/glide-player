package expo.modules.glide

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.MediaFormatUtil
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.container.Mp4OrientationData
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorInput
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.muxer.BufferInfo
import androidx.media3.muxer.Mp4Muxer
import androidx.media3.muxer.SeekableMuxerOutput
import java.io.EOFException
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.min
import kotlin.math.roundToInt

/** The video can't go into MP4 as it is; the caller falls back to re-encoding with Transformer. */
internal class UnsupportedVideoException(mime: String?) : Exception("Video format ${mime ?: "unknown"} can't be copied into MP4")

internal class RemuxCancelled : Exception("Saving was cancelled.")

/** A subtitle file written next to the copy (in the app's storage), for the player to load with it. */
internal data class SidecarSubtitle(val file: File, val mimeType: String, val label: String, val language: String?, val selected: Boolean)

internal data class RemuxResult(val subtitles: List<SidecarSubtitle>, val notes: List<String>)

/**
 * Rewrites a video into an MP4 (which always has a seek index) without re-encoding the picture,
 * keeping every audio track and the text subtitles:
 *
 * - video and audio tracks that MP4 can hold are copied sample by sample;
 * - other audio (AC-3, E-AC-3, DTS, MP3, FLAC…) is decoded and re-encoded as AAC, when the phone
 *   has a decoder for it (DTS and TrueHD usually aren't available, those tracks are skipped);
 * - text subtitles (SRT, ASS/SSA, WebVTT) are saved as .srt / .ass / .vtt files, because Media3's
 *   MP4 writer has no subtitle tracks. Picture-based subtitles (PGS, VobSub) are skipped.
 *
 * The file is read once from start to end, so it works for files without a seek index.
 * Blocking: run it on a worker thread.
 */
@OptIn(UnstableApi::class)
internal class Remuxer(
  private val context: Context,
  private val uri: Uri,
  private val output: File,
  private val subtitleDir: File,
  private val subtitleBaseName: String,
  private val keepAudio: Boolean,
  private val onProgress: (Int) -> Unit,
) {
  @Volatile var cancelled = false

  private lateinit var muxer: Mp4Muxer
  private val tracks = ArrayList<Out>()
  private val notes = ArrayList<String>()
  private var videoTaken = false

  fun run(): RemuxResult {
    val dataSource = DefaultDataSource(context, /* allowCrossProtocolRedirects= */ false)
    var extractor: Extractor? = null
    var ok = false
    try {
      val length = dataSource.open(DataSpec(uri)) // C.LENGTH_UNSET (-1) when unknown
      var input: ExtractorInput = DefaultExtractorInput(dataSource, 0, length)
      // sniff() only peeks (and resets the peek position), so reading continues from the start.
      val ex = sniff(input)
      extractor = ex
      muxer = Mp4Muxer.Builder(SeekableMuxerOutput.of(output.absolutePath)).setSampleCopyingEnabled(true).build()
      ex.init(Output())
      val position = PositionHolder()
      var lastPercent = -1
      while (true) {
        if (cancelled) throw RemuxCancelled()
        val result = ex.read(input, position)
        if (result == Extractor.RESULT_END_OF_INPUT) break
        if (result == Extractor.RESULT_SEEK) {
          // The extractor wants to read another part of the file (e.g. an index at the end).
          dataSource.close()
          val remaining = if (length < 0) C.LENGTH_UNSET.toLong() else length - position.position
          dataSource.open(DataSpec.Builder().setUri(uri).setPosition(position.position).setLength(remaining).build())
          input = DefaultExtractorInput(dataSource, position.position, length)
          continue
        }
        if (length > 0) {
          val percent = (input.position * 99 / length).toInt()
          if (percent != lastPercent) {
            lastPercent = percent
            onProgress(percent)
          }
        }
      }
      tracks.forEach { it.finish() }
      if (!videoTaken) throw IllegalStateException("No video track was found in this file.")
      ok = true
    } finally {
      try {
        extractor?.release()
      } catch (_: Exception) {}
      try {
        dataSource.close()
      } catch (_: Exception) {}
      tracks.forEach { it.release() }
      if (::muxer.isInitialized) {
        try {
          muxer.close()
        } catch (e: Exception) {
          if (ok) throw e
        }
      }
    }
    val subs = tracks.filterIsInstance<SubtitleOut>().mapIndexedNotNull { i, t -> t.write(i) }
    return RemuxResult(subs, notes)
  }

  /** Finds the extractor for this file (MKV, MP4, TS, WebM, AVI, FLV…), with subtitles left as raw text. */
  @Suppress("DEPRECATION")
  private fun sniff(input: ExtractorInput): Extractor {
    val candidates = DefaultExtractorsFactory()
      .setTextTrackTranscodingEnabled(false)
      .createExtractors(uri, emptyMap())
    for (e in candidates) {
      val match = try {
        e.sniff(input)
      } catch (_: EOFException) {
        false
      } finally {
        input.resetPeekPosition()
      }
      if (match) {
        candidates.filter { it !== e }.forEach { it.release() }
        return e
      }
    }
    candidates.forEach { it.release() }
    throw IllegalStateException("This file's format isn't recognised.")
  }

  private inner class Output : ExtractorOutput {
    override fun track(id: Int, type: Int): TrackOutput {
      val out: Out = when (type) {
        C.TRACK_TYPE_VIDEO -> VideoOut()
        C.TRACK_TYPE_AUDIO -> if (keepAudio) AudioOut() else SkipOut()
        C.TRACK_TYPE_TEXT -> SubtitleOut()
        else -> SkipOut()
      }
      tracks += out
      return out
    }

    override fun endTracks() = Unit

    override fun seekMap(seekMap: SeekMap) = Unit
  }

  /** Collects a track's bytes until the extractor says where each sample ends. */
  private abstract inner class Out : TrackOutput {
    var format: Format? = null
    private var buf = ByteArray(256 * 1024)
    private var end = 0

    private fun ensure(extra: Int) {
      if (end + extra <= buf.size) return
      var n = buf.size
      while (n < end + extra) n *= 2
      buf = buf.copyOf(n)
    }

    override fun format(format: Format) {
      this.format = format
    }

    override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
      ensure(length)
      val read = input.read(buf, end, length)
      if (read == C.RESULT_END_OF_INPUT) {
        if (allowEndOfInput) return C.RESULT_END_OF_INPUT
        throw EOFException()
      }
      end += read
      return read
    }

    override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
      ensure(length)
      data.readBytes(buf, end, length)
      end += length
    }

    override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
      val start = end - offset - size
      if (start < 0) return
      if (cryptoData == null) {
        if (flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA != 0 && size >= 4) {
          // Layout: main size (4 bytes, big-endian) || main data || supplemental data (e.g. HDR10+).
          val main = ((buf[start].toInt() and 0xFF) shl 24) or ((buf[start + 1].toInt() and 0xFF) shl 16) or
            ((buf[start + 2].toInt() and 0xFF) shl 8) or (buf[start + 3].toInt() and 0xFF)
          if (main in 0..(size - 4)) onSample(buf, start + 4, main, timeUs, flags and C.BUFFER_FLAG_HAS_SUPPLEMENTAL_DATA.inv())
        } else {
          onSample(buf, start, size, timeUs, flags)
        }
      }
      // Keep the bytes that already belong to the next sample.
      System.arraycopy(buf, end - offset, buf, 0, offset)
      end = offset
    }

    abstract fun onSample(data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int)

    open fun finish() = Unit

    open fun release() = Unit
  }

  private inner class SkipOut : Out() {
    override fun onSample(data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int) = Unit
  }

  private fun write(track: Int, data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int) {
    val copy = ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder())
    copy.put(data, start, size).flip()
    muxer.writeSampleData(track, copy, BufferInfo(timeUs, size, flags and C.BUFFER_FLAG_KEY_FRAME))
  }

  private inner class VideoOut : Out() {
    private var track = -2 // -2: not decided yet, -1: skipped

    override fun onSample(data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int) {
      if (track == -2) {
        val f = format ?: return
        track = when {
          videoTaken -> -1 // a second picture track (e.g. cover art): leave it out
          f.sampleMimeType in Mp4Muxer.SUPPORTED_VIDEO_SAMPLE_MIME_TYPES -> {
            videoTaken = true
            // The MP4 writer takes the rotation from metadata, not from the Format.
            if (f.rotationDegrees in listOf(90, 180, 270)) muxer.addMetadataEntry(Mp4OrientationData(f.rotationDegrees))
            muxer.addTrack(0, mp4VideoFormat(f))
          }
          MimeTypes.isImage(f.sampleMimeType) || f.sampleMimeType == MimeTypes.VIDEO_MJPEG -> -1
          else -> throw UnsupportedVideoException(f.sampleMimeType)
        }
      }
      if (track >= 0) write(track, data, start, size, timeUs, flags)
    }

    /**
     * The MP4 writer only has Dolby Vision boxes for profiles 5, 8 and 9 (and needs the profile in
     * `codecs`); other profiles (e.g. 7 from Blu-ray rips) are written as their HEVC/AVC base layer.
     */
    private fun mp4VideoFormat(f: Format): Format {
      if (f.sampleMimeType != MimeTypes.VIDEO_DOLBY_VISION) return f
      val codecs = f.codecs
      val profile = codecs?.split('.')?.getOrNull(1)?.toIntOrNull()
      if (profile == 5 || profile == 8 || profile == 9) return f
      val avc = codecs?.startsWith("dvav") == true || codecs?.startsWith("dva1") == true
      return f.buildUpon().setSampleMimeType(if (avc) MimeTypes.VIDEO_H264 else MimeTypes.VIDEO_H265).setCodecs(null).build()
    }
  }

  private inner class AudioOut : Out() {
    private var track = -2
    private var transcoder: AacTranscoder? = null

    override fun onSample(data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int) {
      if (track == -2) {
        val f = format ?: return
        track = if (f.sampleMimeType in Mp4Muxer.SUPPORTED_AUDIO_SAMPLE_MIME_TYPES && f.sampleMimeType != MimeTypes.AUDIO_RAW) {
          muxer.addTrack(1, f)
        } else {
          transcoder = try {
            AacTranscoder(f) { fmt -> muxer.addTrack(1, fmt.buildUpon().setLanguage(f.language).setLabel(f.label).build()) }
          } catch (e: Exception) {
            notes += "Left out ${describe(f)}: this phone can't decode ${codecName(f.sampleMimeType)}."
            null
          }
          if (transcoder != null) -3 else -1
        }
      }
      when {
        track >= 0 -> write(track, data, start, size, timeUs, flags)
        track == -3 -> transcoder?.let { t ->
          try {
            t.queue(data, start, size, timeUs) { trk, buf, info -> muxer.writeSampleData(trk, buf, info) }
          } catch (e: Exception) {
            notes += "Left out the rest of ${describe(format)}: converting it failed (${e.message})."
            t.release()
            transcoder = null
            track = -1
          }
        }
      }
    }

    override fun finish() {
      try {
        transcoder?.finish { trk, buf, info -> muxer.writeSampleData(trk, buf, info) }
      } catch (e: Exception) {
        notes += "The end of ${describe(format)} may be cut short: converting it failed (${e.message})."
      }
    }

    override fun release() {
      transcoder?.release()
    }
  }

  /** Keeps text cues in memory, written out as a subtitle file at the end. */
  private inner class SubtitleOut : Out() {
    private val cues = ArrayList<Triple<Long, Long, String>>()
    private var kind: String? = null
    private var reported = false

    override fun onSample(data: ByteArray, start: Int, size: Int, timeUs: Long, flags: Int) {
      val f = format ?: return
      val mime = f.sampleMimeType
      if (mime != MimeTypes.APPLICATION_SUBRIP && mime != MimeTypes.TEXT_SSA && mime != MimeTypes.TEXT_VTT) {
        if (!reported) {
          reported = true
          val picture = mime == MimeTypes.APPLICATION_PGS || mime == MimeTypes.APPLICATION_VOBSUB || mime == MimeTypes.APPLICATION_DVBSUBS
          notes += if (picture) "Left out ${describe(f)}: picture-based subtitles (${codecName(mime)}) can't be turned into text."
          else "Left out ${describe(f)}: ${codecName(mime)} subtitles can't be copied yet."
        }
        return
      }
      kind = mime
      val text = String(data, start, size, Charsets.UTF_8)
      val cue = if (mime == MimeTypes.TEXT_SSA) parseSsa(text) else parseSrtOrVtt(text)
      if (cue != null) cues += Triple(timeUs, timeUs + cue.first, cue.second)
    }

    /** "1\n00:00:00,000 --> 00:00:02,500\nText" (times relative to the sample) → duration + text. */
    private fun parseSrtOrVtt(sample: String): Pair<Long, String>? {
      val lines = sample.replace("\r\n", "\n").split('\n')
      val timing = lines.indexOfFirst { it.contains("-->") }
      if (timing < 0) return null
      val endUs = parseTime(lines[timing].substringAfter("-->").trim())
      val text = lines.drop(timing + 1).joinToString("\n").trim()
      if (text.isEmpty()) return null
      return Pair(endUs, text)
    }

    /** "Dialogue: 0:00:00:00,0:00:02:50,ReadOrder,Layer,Style,…,Text" → duration + "Layer,Style,…,Text". */
    private fun parseSsa(sample: String): Pair<Long, String>? {
      val body = sample.removePrefix("Dialogue:").trim()
      val parts = body.split(',', limit = 11)
      if (parts.size < 11) return null
      val t = parts[1].trim().split(':')
      val endUs = if (t.size == 4) {
        ((t[0].toLongOrNull() ?: 0) * 3600 + (t[1].toLongOrNull() ?: 0) * 60 + (t[2].toLongOrNull() ?: 0)) * 1_000_000 + (t[3].toLongOrNull() ?: 0) * 10_000
      } else 0L
      // Matroska order: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text.
      val rest = parts.subList(3, 11).joinToString(",")
      return Pair(endUs, rest)
    }

    private fun parseTime(s: String): Long {
      val m = Regex("(\\d+):(\\d{2}):(\\d{2})[,.](\\d{1,3})").find(s) ?: return 0
      val (h, mi, se, ms) = m.destructured
      return ((h.toLong() * 3600 + mi.toLong() * 60 + se.toLong()) * 1000 + ms.padEnd(3, '0').toLong()) * 1000
    }

    fun write(index: Int): SidecarSubtitle? {
      val f = format ?: return null
      val mime = kind ?: return null
      if (cues.isEmpty()) return null
      cues.sortBy { it.first }
      // Cues without a stored length last until the next one (at most 5 s).
      val fixed = cues.mapIndexed { i, (s, e, t) ->
        val next = cues.getOrNull(i + 1)?.first ?: (s + 5_000_000)
        Triple(s, if (e > s) e else min(next, s + 5_000_000), t)
      }
      subtitleDir.mkdirs()
      val lang = f.language?.takeIf { it.isNotBlank() && it != "und" }
      val ext = when (mime) {
        MimeTypes.TEXT_SSA -> "ass"
        MimeTypes.TEXT_VTT -> "vtt"
        else -> "srt"
      }
      val file = File(subtitleDir, "$subtitleBaseName.${index + 1}${lang?.let { ".$it" } ?: ""}.$ext")
      file.bufferedWriter(Charsets.UTF_8).use { w ->
        when (mime) {
          MimeTypes.TEXT_SSA -> {
            val header = f.initializationData.getOrNull(1)?.let { String(it, Charsets.UTF_8).replace("\u0000", "") } ?: "[Script Info]\nScriptType: v4.00+\n"
            val beforeEvents = header.substringBefore("[Events]").trimEnd()
            w.write(beforeEvents)
            w.write("\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
            for ((s, e, t) in fixed) {
              val layerAndRest = t.split(',', limit = 2)
              w.write("Dialogue: ${layerAndRest[0]},${assTime(s)},${assTime(e)},${layerAndRest.getOrElse(1) { "" }}\n")
            }
          }
          MimeTypes.TEXT_VTT -> {
            w.write("WEBVTT\n\n")
            for ((s, e, t) in fixed) w.write("${vttTime(s)} --> ${vttTime(e)}\n$t\n\n")
          }
          else -> fixed.forEachIndexed { i, (s, e, t) -> w.write("${i + 1}\n${srtTime(s)} --> ${srtTime(e)}\n$t\n\n") }
        }
      }
      val label = f.label?.takeIf { it.isNotBlank() } ?: lang?.let { Locale.forLanguageTag(it).displayLanguage.takeIf { d -> d.isNotBlank() } } ?: "Subtitles ${index + 1}"
      return SidecarSubtitle(
        file,
        when (mime) {
          MimeTypes.TEXT_SSA -> MimeTypes.TEXT_SSA
          MimeTypes.TEXT_VTT -> MimeTypes.TEXT_VTT
          else -> MimeTypes.APPLICATION_SUBRIP
        },
        label,
        lang,
        selected = (f.selectionFlags and (C.SELECTION_FLAG_DEFAULT or C.SELECTION_FLAG_FORCED)) != 0,
      )
    }
  }

  private fun describe(f: Format?): String {
    if (f == null) return "a track"
    val lang = f.language?.takeIf { it.isNotBlank() && it != "und" }?.let { Locale.forLanguageTag(it).displayLanguage }
    val kind = if (MimeTypes.isAudio(f.sampleMimeType)) "audio" else "subtitle"
    return listOfNotNull(f.label, lang).firstOrNull()?.let { "the $it $kind track" } ?: "a $kind track"
  }

  private fun srtTime(us: Long): String {
    val ms = us / 1000
    return String.format(Locale.US, "%02d:%02d:%02d,%03d", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000)
  }

  private fun vttTime(us: Long) = srtTime(us).replace(',', '.')

  private fun assTime(us: Long): String {
    val cs = us / 10_000
    return String.format(Locale.US, "%d:%02d:%02d.%02d", cs / 360_000, cs / 6000 % 60, cs / 100 % 60, cs % 100)
  }
}

/**
 * Decodes one audio track (AC-3, DTS, MP3, FLAC…) and encodes it as AAC with MediaCodec,
 * synchronously. More than six channels, or more than the AAC encoder takes, are mixed to stereo.
 */
@OptIn(UnstableApi::class)
internal class AacTranscoder(input: Format, private val addTrack: (Format) -> Int) {
  private val decoder: MediaCodec
  private var encoder: MediaCodec? = null
  private var track = -1
  private var inChannels = 2
  private var outChannels = 2
  private var sampleRate = 48_000
  private var firstPtsUs = -1L
  private var framesQueued = 0L
  private var decoderDone = false
  private var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
  private val info = MediaCodec.BufferInfo()
  private val encInfo = MediaCodec.BufferInfo()

  init {
    val mime = input.sampleMimeType ?: throw IllegalArgumentException("No audio type")
    val format = MediaFormatUtil.createMediaFormatFromFormat(input)
    // Containers often don't give a maximum sample size; the default input buffers can be too small (DTS-HD, TrueHD).
    if (!format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 512 * 1024)
    val name = MediaCodecList(MediaCodecList.REGULAR_CODECS).findDecoderForFormat(format)
    decoder = if (name != null) MediaCodec.createByCodecName(name) else MediaCodec.createDecoderByType(mime)
    try {
      decoder.configure(format, null, null, 0)
      decoder.start()
    } catch (e: Exception) {
      decoder.release()
      throw e
    }
  }

  fun queue(data: ByteArray, start: Int, size: Int, timeUs: Long, write: (Int, ByteBuffer, androidx.media3.muxer.BufferInfo) -> Unit) {
    while (true) {
      val i = decoder.dequeueInputBuffer(10_000)
      if (i >= 0) {
        val b = decoder.getInputBuffer(i)!!
        b.clear()
        val n = min(size, b.capacity())
        b.put(data, start, n)
        decoder.queueInputBuffer(i, 0, n, timeUs, 0)
        break
      }
      drainDecoder(write)
    }
    drainDecoder(write)
  }

  fun finish(write: (Int, ByteBuffer, androidx.media3.muxer.BufferInfo) -> Unit) {
    var i = -1
    while (i < 0) {
      i = decoder.dequeueInputBuffer(10_000)
      if (i < 0) drainDecoder(write)
    }
    decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    // Wait (10 ms at a time, at most ~20 s) for the codecs to give back what they still hold.
    var guard = 0
    while (!decoderDone && guard++ < 2_000) drainDecoder(write, 10_000)
    val enc = encoder ?: return
    var j = -1
    while (j < 0) {
      j = enc.dequeueInputBuffer(10_000)
      if (j < 0) drainEncoder(write)
    }
    enc.queueInputBuffer(j, 0, 0, presentationUs(), MediaCodec.BUFFER_FLAG_END_OF_STREAM)
    guard = 0
    while (guard++ < 2_000) if (drainEncoder(write, 10_000)) break
  }

  fun release() {
    try {
      decoder.release()
    } catch (_: Exception) {}
    try {
      encoder?.release()
    } catch (_: Exception) {}
    encoder = null
  }

  private fun drainDecoder(write: (Int, ByteBuffer, androidx.media3.muxer.BufferInfo) -> Unit, timeoutUs: Long = 0) {
    while (true) {
      val o = decoder.dequeueOutputBuffer(info, timeoutUs)
      when {
        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> setUpEncoder(decoder.outputFormat)
        o >= 0 -> {
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          if (info.size > 0) {
            if (encoder == null) setUpEncoder(decoder.outputFormat)
            if (firstPtsUs < 0) firstPtsUs = info.presentationTimeUs
            val pcm = decoder.getOutputBuffer(o)!!
            pcm.position(info.offset).limit(info.offset + info.size)
            feedEncoder(mix(pcm.slice().order(ByteOrder.nativeOrder())), write)
          }
          decoder.releaseOutputBuffer(o, false)
          if (eos) {
            decoderDone = true
            return
          }
        }
        else -> return
      }
    }
  }

  private fun setUpEncoder(decoded: MediaFormat) {
    // The decoder may change its output mid-stream (e.g. 2.0 ↔ 5.1 in broadcast AC-3): only the input side changes then.
    inChannels = decoded.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    pcmEncoding = if (decoded.containsKey(MediaFormat.KEY_PCM_ENCODING)) decoded.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
    if (pcmEncoding !in listOf(AudioFormat.ENCODING_PCM_16BIT, AudioFormat.ENCODING_PCM_8BIT, AudioFormat.ENCODING_PCM_FLOAT, ENCODING_PCM_24BIT_PACKED, ENCODING_PCM_32BIT)) {
      throw IllegalStateException("Unsupported PCM encoding $pcmEncoding")
    }
    if (encoder != null) {
      if (decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE) != sampleRate) throw IllegalStateException("The sample rate changed mid-stream")
      return
    }
    sampleRate = decoded.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    val maxEncoderChannels = aacMaxChannels()
    outChannels = if (inChannels <= maxEncoderChannels && inChannels <= 6) inChannels else 2
    val f = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, outChannels)
    f.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
    f.setInteger(MediaFormat.KEY_BIT_RATE, (if (outChannels > 2) 96_000 * outChannels / 2 else 192_000).coerceAtMost(512_000))
    f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 64 * 1024)
    val enc = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    try {
      enc.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      enc.start()
    } catch (e: Exception) {
      enc.release()
      throw e
    }
    encoder = enc
  }

  private fun aacMaxChannels(): Int =
    try {
      MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filter { it.isEncoder && it.supportedTypes.any { t -> t.equals(MediaFormat.MIMETYPE_AUDIO_AAC, true) } }
        .maxOfOrNull { it.getCapabilitiesForType(MediaFormat.MIMETYPE_AUDIO_AAC).audioCapabilities.maxInputChannelCount } ?: 2
    } catch (_: Exception) {
      2
    }

  /** Decoded PCM (any of the usual encodings) as 16-bit samples. */
  private fun toShorts(pcm: ByteBuffer): ShortArray {
    val b = pcm.order(ByteOrder.nativeOrder())
    val p = b.position()
    return when (pcmEncoding) {
      AudioFormat.ENCODING_PCM_8BIT -> ShortArray(b.remaining()) { (((b.get(p + it).toInt() and 0xFF) - 128) shl 8).toShort() }
      AudioFormat.ENCODING_PCM_FLOAT -> {
        val fl = b.asFloatBuffer()
        ShortArray(fl.remaining()) { (fl.get(it) * 32767f).roundToInt().coerceIn(-32768, 32767).toShort() }
      }
      ENCODING_PCM_24BIT_PACKED -> ShortArray(b.remaining() / 3) { (((b.get(p + it * 3 + 2).toInt()) shl 8) or (b.get(p + it * 3 + 1).toInt() and 0xFF)).toShort() }
      ENCODING_PCM_32BIT -> {
        val ints = b.asIntBuffer()
        ShortArray(ints.remaining()) { (ints.get(it) shr 16).toShort() }
      }
      else -> ShortArray(b.remaining() / 2).also { b.asShortBuffer().get(it) }
    }
  }

  /**
   * PCM with [inChannels] → 16-bit PCM with [outChannels]: a plain stereo fold-down when the
   * encoder takes stereo, otherwise channels are copied (missing ones silent).
   */
  private fun mix(pcm: ByteBuffer): ByteBuffer {
    if (inChannels == outChannels && pcmEncoding == AudioFormat.ENCODING_PCM_16BIT) return pcm
    val samples = toShorts(pcm)
    val frames = samples.size / inChannels
    val out = ByteBuffer.allocate(frames * outChannels * 2).order(ByteOrder.nativeOrder())
    val outS = out.asShortBuffer()
    for (k in 0 until frames) {
      val o = k * inChannels
      if (outChannels != 2 || inChannels == 2) {
        for (c in 0 until outChannels) outS.put(if (c < inChannels) samples[o + c] else 0.toShort())
        continue
      }
      var l: Float
      var r: Float
      if (inChannels == 1) {
        l = samples[o].toFloat(); r = l
      } else {
        // Android order: FL, FR, FC, LFE, BL/SL, BR/SR, …
        l = samples[o].toFloat(); r = samples[o + 1].toFloat()
        if (inChannels >= 3) { l += 0.707f * samples[o + 2]; r += 0.707f * samples[o + 2] }
        if (inChannels >= 6) { l += 0.707f * samples[o + 4]; r += 0.707f * samples[o + 5] }
        val norm = if (inChannels >= 6) 1f / 2.414f else if (inChannels >= 3) 1f / 1.707f else 1f
        l *= norm; r *= norm
      }
      outS.put(l.roundToInt().coerceIn(-32768, 32767).toShort())
      outS.put(r.roundToInt().coerceIn(-32768, 32767).toShort())
    }
    return out
  }

  private companion object {
    // AudioFormat constants added in API 31 (inlined at compile time).
    const val ENCODING_PCM_24BIT_PACKED = 21
    const val ENCODING_PCM_32BIT = 22
  }

  private fun presentationUs(): Long = (if (firstPtsUs < 0) 0 else firstPtsUs) + framesQueued * 1_000_000L / sampleRate

  private fun feedEncoder(pcm: ByteBuffer, write: (Int, ByteBuffer, androidx.media3.muxer.BufferInfo) -> Unit) {
    val enc = encoder ?: return
    val frameBytes = 2 * outChannels
    while (pcm.hasRemaining()) {
      val i = enc.dequeueInputBuffer(10_000)
      if (i < 0) {
        drainEncoder(write)
        continue
      }
      val b = enc.getInputBuffer(i)!!
      b.clear()
      val n = min(pcm.remaining(), b.capacity() / frameBytes * frameBytes)
      val slice = pcm.slice().order(pcm.order())
      slice.limit(n)
      b.put(slice)
      pcm.position(pcm.position() + n)
      enc.queueInputBuffer(i, 0, n, presentationUs(), 0)
      framesQueued += n / frameBytes
      drainEncoder(write)
    }
  }

  /** Writes finished AAC frames to the muxer; true at end of stream. */
  private fun drainEncoder(write: (Int, ByteBuffer, androidx.media3.muxer.BufferInfo) -> Unit, timeoutUs: Long = 0): Boolean {
    val enc = encoder ?: return true
    val info = encInfo
    while (true) {
      val o = enc.dequeueOutputBuffer(info, timeoutUs)
      when {
        o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
          if (track < 0) track = addTrack(MediaFormatUtil.createFormatFromMediaFormat(enc.outputFormat))
        }
        o >= 0 -> {
          val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!config && info.size > 0 && track >= 0) {
            val src = enc.getOutputBuffer(o)!!
            src.position(info.offset).limit(info.offset + info.size)
            val copy = ByteBuffer.allocateDirect(info.size).order(ByteOrder.nativeOrder())
            copy.put(src).flip()
            write(track, copy, androidx.media3.muxer.BufferInfo(info.presentationTimeUs, info.size, C.BUFFER_FLAG_KEY_FRAME))
          }
          enc.releaseOutputBuffer(o, false)
          if (eos) return true
        }
        else -> return false
      }
    }
  }
}

/** A readable name for audio and subtitle formats people meet in films (used in notes and the track list). */
internal fun codecName(mime: String?): String = when (mime) {
  MimeTypes.AUDIO_AC3 -> "Dolby Digital (AC-3)"
  MimeTypes.AUDIO_E_AC3, MimeTypes.AUDIO_E_AC3_JOC -> "Dolby Digital Plus"
  MimeTypes.AUDIO_TRUEHD -> "Dolby TrueHD"
  MimeTypes.AUDIO_DTS, MimeTypes.AUDIO_DTS_HD, MimeTypes.AUDIO_DTS_EXPRESS, MimeTypes.AUDIO_DTS_UHD_P2 -> "DTS"
  MimeTypes.APPLICATION_PGS -> "PGS"
  MimeTypes.APPLICATION_VOBSUB -> "VobSub"
  MimeTypes.APPLICATION_DVBSUBS -> "DVB"
  else -> mime ?: "this format"
}

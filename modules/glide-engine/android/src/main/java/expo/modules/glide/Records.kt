package expo.modules.glide

import android.app.Activity
import android.os.Build
import android.view.Display
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class SubtitleRecord : Record {
  @Field val uri: String = ""
  @Field val mimeType: String? = null
  @Field val language: String? = null
  @Field val label: String? = null
}

class SourceRecord : Record {
  @Field val uri: String = ""
  @Field val title: String? = null
  @Field val startPositionMs: Double = 0.0
  @Field val subtitles: List<SubtitleRecord> = emptyList()
}

/** How subtitles look (see SubtitleStyle in GlideEngine.types.ts). */
class SubtitleStyleRecord : Record {
  /** 1 = normal size. */
  @Field val scale: Double = 1.0
  /** "sans", "serif", "mono", "condensed" or "casual". */
  @Field val font: String = "sans"
  @Field val bold: Boolean = false
  @Field val color: String = "#FFFFFF"
  /** "none", "box" (behind the text) or "band" (full-width strip). */
  @Field val background: String = "none"
  @Field val backgroundColor: String = "#000000"
  @Field val backgroundOpacity: Double = 0.5
  /** "none", "outline", "shadow", "raised" or "depressed". */
  @Field val edge: String = "outline"
  @Field val edgeColor: String = "#000000"
  /** Distance from the bottom, as a fraction of the picture height. */
  @Field val position: Double = 0.08
  /** Use colours, fonts and sizes from the subtitle file (ASS, embedded tracks). */
  @Field val useFileStyles: Boolean = true
}

class ExportOptions : Record {
  @Field val uri: String = ""
  @Field val title: String = "video"
  /** Frames per second of the saved video. */
  @Field val fps: Int = 60
  /** 1 = normal speed; 2, 4 or 8 = that many times slower. */
  @Field val slowMotion: Int = 1
  /** "balanced", "detailed" or "export" (best). */
  @Field val quality: String = "export"
  @Field val keepAudio: Boolean = true
  /** Size of the video, to pick an encoder bitrate that suits the higher frame rate. */
  @Field val width: Int = 1920
  @Field val height: Int = 1080
  /**
   * Seekable copy instead of a smooth one: the same picture and main audio track rewritten into
   * an MP4 (which always has a seek index). Streams are copied as they are when MP4 can hold
   * them, so there's no quality loss; others are converted.
   */
  @Field val remux: Boolean = false
}

internal object DisplayInfo {
  @Suppress("DEPRECATION")
  fun display(activity: Activity?): Display? {
    if (activity == null) return null
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) activity.display else activity.windowManager.defaultDisplay
  }

  /** Refresh rates offered at the current resolution, lowest first. */
  fun refreshRates(activity: Activity?): List<Float> {
    val d = display(activity) ?: return listOf(60f)
    val cur = d.mode
    return d.supportedModes
      .filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
      .map { it.refreshRate }
      .distinct()
      .sorted()
      .ifEmpty { listOf(d.refreshRate) }
  }

  fun maxRefreshRate(activity: Activity?): Float = refreshRates(activity).maxOrNull() ?: 60f

  fun currentRefreshRate(activity: Activity?): Float = display(activity)?.refreshRate ?: 60f
}

package expo.modules.glide

import android.content.Context
import android.media.AudioManager
import androidx.media3.common.C
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.roundToInt

class GlideEngineModule : Module() {
  private var exporter: SmoothExporter? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private fun audioManager() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  override fun definition() = ModuleDefinition {
    Name("GlideEngine")

    Events("onExportProgress")

    Function("getDisplayInfo") {
      val activity = appContext.currentActivity
      mapOf(
        "refreshRates" to DisplayInfo.refreshRates(activity).map { it.toDouble() },
        "maxRefreshRate" to DisplayInfo.maxRefreshRate(activity).toDouble(),
        "currentRefreshRate" to DisplayInfo.currentRefreshRate(activity).toDouble(),
      )
    }

    Function("getVolume") {
      val am = audioManager()
      am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
    }

    Function("setVolume") { fraction: Double ->
      val am = audioManager()
      val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      am.setStreamVolume(AudioManager.STREAM_MUSIC, (fraction.coerceIn(0.0, 1.0) * max).roundToInt(), 0)
      am.getStreamVolume(AudioManager.STREAM_MUSIC).toDouble() / max.coerceAtLeast(1)
    }

    AsyncFunction("exportSmooth") { options: ExportOptions, promise: Promise ->
      val ex = exporter ?: SmoothExporter(context) { p ->
        sendEvent("onExportProgress", mapOf("progress" to p))
      }.also { exporter = it }
      ex.start(options, promise)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelExport") {
      exporter?.cancel()
    }.runOnQueue(Queues.MAIN)

    OnUserLeavesActivity {
      GlidePlayerView.active?.get()?.onUserLeaveHint()
    }

    OnActivityEntersBackground {
      GlidePlayerView.active?.get()?.onHostBackground()
    }

    View(GlidePlayerView::class) {
      Events("onLoad", "onProgress", "onStats", "onEnd", "onError", "onTracks", "onPlaybackState", "onPipChange")

      Prop("source") { view: GlidePlayerView, source: SourceRecord? -> view.setSource(source) }
      Prop("paused") { view: GlidePlayerView, paused: Boolean -> view.setPaused(paused) }
      Prop("rate") { view: GlidePlayerView, rate: Double -> view.setRate(rate) }
      Prop("muted") { view: GlidePlayerView, muted: Boolean -> view.setMuted(muted) }
      Prop("mode") { view: GlidePlayerView, mode: String -> view.setMode(mode) }
      Prop("quality") { view: GlidePlayerView, quality: String -> view.setQuality(quality) }
      Prop("targetFps") { view: GlidePlayerView, fps: Int -> view.setTargetFps(fps) }
      Prop("compare") { view: GlidePlayerView, compare: Boolean -> view.setCompare(compare) }
      Prop("split") { view: GlidePlayerView, split: Double -> view.setSplit(split) }
      Prop("showVectors") { view: GlidePlayerView, show: Boolean -> view.setShowVectors(show) }
      Prop("resizeMode") { view: GlidePlayerView, mode: String -> view.setResizeMode(mode) }
      Prop("pipEnabled") { view: GlidePlayerView, enabled: Boolean -> view.setPipEnabled(enabled) }
      Prop("backgroundAudio") { view: GlidePlayerView, enabled: Boolean -> view.setBackgroundAudio(enabled) }
      Prop("subtitlesVisible") { view: GlidePlayerView, visible: Boolean -> view.setSubtitlesVisible(visible) }
      Prop("audioDelayMs") { view: GlidePlayerView, ms: Double -> view.setAudioDelay(ms) }
      Prop("subtitleDelayMs") { view: GlidePlayerView, ms: Double -> view.setSubtitleDelay(ms) }
      Prop("subtitleStyle") { view: GlidePlayerView, style: SubtitleStyleRecord? -> view.setSubtitleStyle(style) }

      AsyncFunction("seekTo") { view: GlidePlayerView, positionMs: Double -> view.seekTo(positionMs.toLong()) }
      AsyncFunction("setAudioTrack") { view: GlidePlayerView, id: String? -> view.selectTrack(C.TRACK_TYPE_AUDIO, id) }
      AsyncFunction("setTextTrack") { view: GlidePlayerView, id: String? -> view.selectTrack(C.TRACK_TYPE_TEXT, id) }
      AsyncFunction("enterPip") { view: GlidePlayerView -> view.enterPip() }

      OnViewDestroys { view: GlidePlayerView -> view.release() }
    }
  }
}

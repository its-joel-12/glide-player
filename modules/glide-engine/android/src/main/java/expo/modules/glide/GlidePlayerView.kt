package expo.modules.glide

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Rational
import android.view.Gravity
import android.view.Surface
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.annotation.OptIn
import androidx.annotation.RequiresApi
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.VideoSize
import androidx.media3.common.text.CueGroup
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.CaptionStyleCompat
import androidx.media3.ui.SubtitleView
import com.google.common.util.concurrent.ListenableFuture
import expo.modules.glide.memc.MemcSettings
import expo.modules.glide.memc.Quality
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.lang.ref.WeakReference
import java.util.Locale
import kotlin.math.max

/**
 * The video surface. Playback state lives in the shared [PlayerHolder] player; this view
 * connects it to the screen, forwards props to the smoothing settings and reports events.
 */
@OptIn(UnstableApi::class)
class GlidePlayerView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onLoad by EventDispatcher()
  private val onProgress by EventDispatcher()
  private val onStats by EventDispatcher()
  private val onEnd by EventDispatcher()
  private val onError by EventDispatcher()
  private val onTracks by EventDispatcher()
  private val onPlaybackState by EventDispatcher()
  private val onPipChange by EventDispatcher()

  private val container = FrameLayout(context)
  private val aspect = AspectRatioFrameLayout(context)
  private val surfaceView = SurfaceView(context)
  private val subtitleView = SubtitleView(context)
  private var player: ExoPlayer = PlayerHolder.obtain(context)
  private val settings: MemcSettings = PlayerHolder.settings
  private val handler = Handler(Looper.getMainLooper())

  private var currentUri: String? = null
  private var rateValue = 1f
  private var mutedValue = false
  private var currentSubtitles: List<String> = emptyList()
  private var loadedSent = false
  private var targetFpsSetting = 0
  private var pipEnabled = true
  private var backgroundAudio = false
  private var inPip = false
  private var released = false
  private var controller: ListenableFuture<MediaController>? = null
  private var pipActivity: ComponentActivity? = null

  private var statsAt = 0L
  private var statsIn = 0L
  private var statsOut = 0L
  private var statsGen = 0L
  private var statsRendered = 0L
  private var statsDropped = 0L

  // region Player events

  private val listener = object : Player.Listener {
    override fun onPlaybackStateChanged(playbackState: Int) {
      if (playbackState == Player.STATE_READY && !loadedSent) {
        loadedSent = true
        sendLoad()
      }
      if (playbackState == Player.STATE_ENDED) onEnd(emptyMap())
      sendPlaybackState()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      keepScreenOn = isPlaying
      sendPlaybackState()
      updatePipParams()
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      sendPlaybackState()
    }

    override fun onVideoSizeChanged(videoSize: VideoSize) {
      if (videoSize.width > 0 && videoSize.height > 0) {
        aspect.setAspectRatio(videoSize.width * videoSize.pixelWidthHeightRatio / videoSize.height)
        updatePipParams()
      }
    }

    override fun onTracksChanged(tracks: Tracks) {
      sendTracks(tracks)
    }

    override fun onCues(cueGroup: CueGroup) {
      subtitleView.setCues(cueGroup.cues)
    }

    override fun onPlayerError(error: PlaybackException) {
      // Some videos (protected or unusual formats) can't go through the GPU effect. Play them without it.
      if (PlayerHolder.effectsEnabled && error.errorCode == PlaybackException.ERROR_CODE_VIDEO_FRAME_PROCESSING_FAILED) {
        val item = player.currentMediaItem
        val position = player.currentPosition
        val play = player.playWhenReady
        if (item != null) {
          switchPlayer(withEffects = false)
          player.setMediaItem(item, position)
          player.playWhenReady = play
          player.prepare()
          onError(mapOf("message" to "Smoothing isn't available for this video, so it plays normally.", "code" to "EFFECT_UNAVAILABLE", "fatal" to false))
          return
        }
      }
      onError(mapOf("message" to (error.message ?: error.errorCodeName), "code" to error.errorCodeName, "fatal" to true))
    }
  }

  private fun sendLoad() {
    val format = player.videoFormat
    val size = player.videoSize
    onLoad(
      mapOf(
        "durationMs" to durationMs(),
        "width" to size.width,
        "height" to size.height,
        "frameRate" to (format?.frameRate?.takeIf { it > 0 }?.toDouble() ?: 0.0),
        "maxRefreshRate" to DisplayInfo.maxRefreshRate(activity()).toDouble(),
        "smoothing" to PlayerHolder.effectsEnabled,
      )
    )
  }

  private fun sendPlaybackState() {
    onPlaybackState(
      mapOf(
        "isPlaying" to player.isPlaying,
        "playWhenReady" to player.playWhenReady,
        "buffering" to (player.playbackState == Player.STATE_BUFFERING),
        "ended" to (player.playbackState == Player.STATE_ENDED),
      )
    )
  }

  private fun sendTracks(tracks: Tracks) {
    val audio = ArrayList<Map<String, Any>>()
    val text = ArrayList<Map<String, Any>>()
    tracks.groups.forEachIndexed { gi, group ->
      if (group.type != C.TRACK_TYPE_AUDIO && group.type != C.TRACK_TYPE_TEXT) return@forEachIndexed
      for (ti in 0 until group.length) {
        if (!group.isTrackSupported(ti)) continue
        val f = group.getTrackFormat(ti)
        val list = if (group.type == C.TRACK_TYPE_AUDIO) audio else text
        list += mapOf(
          "id" to "$gi:$ti",
          "label" to trackLabel(f, list.size + 1, group.type),
          "language" to (f.language ?: ""),
          "selected" to group.isTrackSelected(ti),
        )
      }
    }
    onTracks(mapOf("audio" to audio, "text" to text))
  }

  private fun trackLabel(f: Format, n: Int, type: Int): String {
    val language = f.language?.takeIf { it.isNotBlank() && it != "und" }?.let { Locale.forLanguageTag(it).displayLanguage }
    val base = f.label ?: language ?: (if (type == C.TRACK_TYPE_AUDIO) "Audio $n" else "Subtitles $n")
    if (type != C.TRACK_TYPE_AUDIO) return base
    val channels = when (f.channelCount) {
      1 -> " · Mono"
      2 -> " · Stereo"
      6 -> " · 5.1"
      8 -> " · 7.1"
      else -> ""
    }
    return base + channels
  }

  private fun durationMs(): Double = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }?.toDouble() ?: 0.0

  // endregion

  // region Ticker (progress 4×/s, stats 1×/s)

  private val ticker = object : Runnable {
    var n = 0
    override fun run() {
      if (released) return
      onProgress(
        mapOf(
          "positionMs" to player.currentPosition.toDouble(),
          "durationMs" to durationMs(),
          "bufferedMs" to player.bufferedPosition.toDouble(),
        )
      )
      if (++n % 4 == 0) sendStats()
      handler.postDelayed(this, 250)
    }
  }

  private fun sendStats() {
    val st = PlayerHolder.stats
    val now = SystemClock.elapsedRealtime()
    val inF = st.inputFrames.get()
    val outF = st.outputFrames.get()
    val genF = st.generatedFrames.get()
    val timing = PlayerHolder.timing
    val rendered = timing.renderedFrames.get()
    val dropped = timing.droppedFrames.get()
    if (statsAt > 0) {
      val dt = (now - statsAt) / 1000.0
      if (dt > 0.2) {
        onStats(
          mapOf(
            "inputFps" to (inF - statsIn) / dt,
            "outputFps" to (outF - statsOut) / dt,
            "generatedFps" to (genF - statsGen) / dt,
            "renderedFps" to (rendered - statsRendered) / dt,
            "droppedFps" to (dropped - statsDropped) / dt,
            "sourceFps" to (player.videoFormat?.frameRate?.takeIf { it > 0 }?.toDouble() ?: 0.0),
            "targetFps" to settings.targetFps.toDouble(),
            "displayHz" to DisplayInfo.currentRefreshRate(activity()).toDouble(),
            "motion" to st.motionActive,
            "smoothing" to PlayerHolder.effectsEnabled,
          )
        )
      }
    }
    statsAt = now
    statsIn = inF
    statsOut = outF
    statsGen = genF
    statsRendered = rendered
    statsDropped = dropped
  }

  // endregion

  /** Moves this view (surface + listener) to a new shared player, keeping speed and volume. */
  private fun switchPlayer(withEffects: Boolean) {
    player.removeListener(listener)
    player.clearVideoSurfaceView(surfaceView)
    player = PlayerHolder.obtain(context, withEffects)
    player.setVideoSurfaceView(surfaceView)
    player.addListener(listener)
    player.setPlaybackSpeed(rateValue)
    player.volume = if (mutedValue) 0f else 1f
  }

  // region Props

  fun setSource(source: SourceRecord?) {
    if (source == null || source.uri.isEmpty()) return
    val subs = source.subtitles.map { it.uri }
    if (source.uri == currentUri && subs == currentSubtitles) return
    val sameVideo = source.uri == currentUri
    val start = if (sameVideo) player.currentPosition else source.startPositionMs.toLong()
    currentUri = source.uri
    currentSubtitles = subs
    loadedSent = false
    if (!sameVideo && !PlayerHolder.effectsEnabled) switchPlayer(withEffects = true)

    val item = MediaItem.Builder()
      .setUri(Uri.parse(source.uri))
      .setMediaId(source.uri)
      .setMediaMetadata(MediaMetadata.Builder().setTitle(source.title).setDisplayTitle(source.title).build())
      .setSubtitleConfigurations(
        source.subtitles.mapIndexed { i, s ->
          MediaItem.SubtitleConfiguration.Builder(Uri.parse(s.uri))
            .setMimeType(s.mimeType ?: subtitleMime(s.uri))
            .setLanguage(s.language)
            .setLabel(s.label)
            // The file added last is switched on; earlier ones stay in the list.
            .setSelectionFlags(if (i == source.subtitles.lastIndex) C.SELECTION_FLAG_DEFAULT else 0)
            .build()
        }
      )
      .build()
    player.setMediaItem(item, max(0L, start))
    player.prepare()
  }

  private fun subtitleMime(uri: String): String {
    val lower = uri.lowercase(Locale.ROOT)
    return when {
      lower.endsWith(".vtt") -> MimeTypes.TEXT_VTT
      lower.endsWith(".ass") || lower.endsWith(".ssa") -> MimeTypes.TEXT_SSA
      lower.endsWith(".ttml") || lower.endsWith(".dfxp") || lower.endsWith(".xml") -> MimeTypes.APPLICATION_TTML
      else -> MimeTypes.APPLICATION_SUBRIP
    }
  }

  fun setPaused(paused: Boolean) {
    if (paused) {
      if (player.playWhenReady) player.pause()
    } else if (!player.playWhenReady || player.playbackState == Player.STATE_ENDED) {
      if (player.playbackState == Player.STATE_ENDED) player.seekTo(0)
      player.play()
    }
  }

  fun setRate(rate: Double) {
    val r = rate.toFloat().coerceIn(0.1f, 4f)
    rateValue = r
    settings.speed = r
    if (player.playbackParameters.speed != r) player.setPlaybackSpeed(r)
  }

  fun setMuted(muted: Boolean) {
    mutedValue = muted
    player.volume = if (muted) 0f else 1f
  }

  fun setMode(mode: String) {
    settings.mode = when (mode) {
      "off" -> MemcSettings.MODE_OFF
      "blend" -> MemcSettings.MODE_BLEND
      else -> MemcSettings.MODE_MEMC
    }
    redrawIfPaused()
  }

  fun setQuality(quality: String) {
    settings.quality = Quality.from(quality)
  }

  fun setTargetFps(fps: Int) {
    targetFpsSetting = max(0, fps)
    applyDisplayRate()
  }

  fun setCompare(compare: Boolean) {
    settings.compare = compare
    redrawIfPaused()
  }

  fun setSplit(split: Double) {
    settings.split = split.toFloat().coerceIn(0f, 1f)
    redrawIfPaused()
  }

  fun setShowVectors(show: Boolean) {
    settings.showVectors = show
    redrawIfPaused()
  }

  fun setResizeMode(mode: String) {
    aspect.resizeMode = when (mode) {
      "fill" -> AspectRatioFrameLayout.RESIZE_MODE_FILL
      "zoom" -> AspectRatioFrameLayout.RESIZE_MODE_ZOOM
      else -> AspectRatioFrameLayout.RESIZE_MODE_FIT
    }
  }

  fun setPipEnabled(enabled: Boolean) {
    pipEnabled = enabled
    updatePipParams()
  }

  fun setBackgroundAudio(enabled: Boolean) {
    backgroundAudio = enabled
  }

  fun setAudioDelay(ms: Double) {
    PlayerHolder.timing.audioDelayUs = (ms.coerceIn(-10_000.0, 10_000.0) * 1000).toLong()
  }

  fun setSubtitleDelay(ms: Double) {
    PlayerHolder.timing.subtitleDelayUs = (ms.coerceIn(-60_000.0, 60_000.0) * 1000).toLong()
  }

  fun setSubtitleStyle(style: SubtitleStyleRecord?) {
    val st = style ?: SubtitleStyleRecord()
    val base = parseColor(st.color, Color.WHITE)
    val bg = parseColor(st.backgroundColor, Color.BLACK)
    val alpha = (st.backgroundOpacity.coerceIn(0.0, 1.0) * 255).toInt()
    val withAlpha = (alpha shl 24) or (bg and 0xFFFFFF)
    val family = when (st.font) {
      "serif" -> "serif"
      "mono" -> "monospace"
      "condensed" -> "sans-serif-condensed"
      "casual" -> "casual"
      else -> "sans-serif"
    }
    val typeface = Typeface.create(family, if (st.bold) Typeface.BOLD else Typeface.NORMAL)
    val edgeType = when (st.edge) {
      "none" -> CaptionStyleCompat.EDGE_TYPE_NONE
      "shadow" -> CaptionStyleCompat.EDGE_TYPE_DROP_SHADOW
      "raised" -> CaptionStyleCompat.EDGE_TYPE_RAISED
      "depressed" -> CaptionStyleCompat.EDGE_TYPE_DEPRESSED
      else -> CaptionStyleCompat.EDGE_TYPE_OUTLINE
    }
    subtitleView.setStyle(
      CaptionStyleCompat(
        base,
        if (st.background == "box") withAlpha else Color.TRANSPARENT,
        if (st.background == "band") withAlpha else Color.TRANSPARENT,
        edgeType,
        parseColor(st.edgeColor, Color.BLACK),
        typeface,
      )
    )
    subtitleView.setApplyEmbeddedStyles(st.useFileStyles)
    subtitleView.setApplyEmbeddedFontSizes(st.useFileStyles)
    subtitleView.setFractionalTextSize(SubtitleView.DEFAULT_TEXT_SIZE_FRACTION * st.scale.toFloat().coerceIn(0.4f, 3f))
    subtitleView.setBottomPaddingFraction(st.position.toFloat().coerceIn(0f, 0.45f))
  }

  private fun parseColor(value: String, fallback: Int): Int =
    try {
      Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      fallback
    }

  fun setSubtitlesVisible(visible: Boolean) {
    subtitleView.visibility = if (visible) VISIBLE else INVISIBLE
  }

  /** While paused, re-show the current frame so a changed setting is visible straight away. */
  private val redraw = Runnable {
    if (!released && !player.isPlaying && player.playbackState == Player.STATE_READY) PlayerHolder.redraw()
  }

  private fun redrawIfPaused() {
    if (player.isPlaying) return
    handler.removeCallbacks(redraw)
    handler.postDelayed(redraw, 80)
  }

  // endregion

  // region Commands

  fun seekTo(positionMs: Long) {
    player.seekTo(max(0L, positionMs))
  }

  fun selectTrack(type: Int, id: String?) {
    val builder = player.trackSelectionParameters.buildUpon()
    if (id == null) {
      if (type == C.TRACK_TYPE_TEXT) builder.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true) else builder.clearOverridesOfType(type)
    } else {
      val parts = id.split(":")
      val group = parts.getOrNull(0)?.toIntOrNull()?.let { player.currentTracks.groups.getOrNull(it) } ?: return
      val track = parts.getOrNull(1)?.toIntOrNull() ?: return
      if (track !in 0 until group.length) return
      builder.setTrackTypeDisabled(type, false).setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, track))
    }
    player.trackSelectionParameters = builder.build()
  }

  fun enterPip(): Boolean {
    val a = activity() ?: return false
    if (!pipSupported(a)) return false
    return try {
      a.enterPictureInPictureMode(pipParams())
    } catch (e: Exception) {
      false
    }
  }

  // endregion

  // region Picture-in-picture, background, display refresh rate

  private fun activity(): Activity? = appContext.currentActivity

  private fun pipSupported(a: Activity) =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && a.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

  @RequiresApi(Build.VERSION_CODES.O)
  private fun pipParams(): PictureInPictureParams {
    val vs = player.videoSize
    val ratio = if (vs.width > 0 && vs.height > 0) vs.width.toFloat() / vs.height else 16f / 9f
    val rational = when {
      ratio > 2.39f -> Rational(239, 100)
      ratio < 1f / 2.39f -> Rational(100, 239)
      vs.width > 0 && vs.height > 0 -> Rational(vs.width, vs.height)
      else -> Rational(16, 9)
    }
    val builder = PictureInPictureParams.Builder().setAspectRatio(rational)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      builder.setAutoEnterEnabled(pipEnabled && player.isPlaying)
      builder.setSeamlessResizeEnabled(false)
    }
    return builder.build()
  }

  private fun updatePipParams() {
    val a = activity() ?: return
    if (!pipSupported(a)) return
    try {
      a.setPictureInPictureParams(pipParams())
    } catch (_: Exception) {
      // Activity not set up for picture-in-picture (missing manifest flag).
    }
  }

  /** Called when the user presses Home. Android 12+ enters picture-in-picture by itself (auto-enter). */
  internal fun onUserLeaveHint() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && pipEnabled && player.isPlaying) enterPip()
  }

  /** Called when the app goes to the background. */
  internal fun onHostBackground() {
    val a = activity()
    val pip = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && a?.isInPictureInPictureMode == true
    if (!pip && !inPip && !backgroundAudio) player.pause()
  }

  private val pipListener = Consumer<PictureInPictureModeChangedInfo> { info ->
    inPip = info.isInPictureInPictureMode
    onPipChange(mapOf("active" to inPip))
    if (!inPip) handler.postDelayed({ pauseIfPipDismissed() }, 400)
  }

  /** Closing the picture-in-picture window leaves the app stopped in the background. */
  private fun pauseIfPipDismissed() {
    val owner = activity() as? LifecycleOwner ?: return
    if (!owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED) && !backgroundAudio) player.pause()
  }

  private fun resolvedTargetFps(): Float =
    if (targetFpsSetting > 0) targetFpsSetting.toFloat() else DisplayInfo.maxRefreshRate(activity())

  private fun applyDisplayRate() {
    val fps = resolvedTargetFps()
    settings.targetFps = fps
    val a = activity() ?: return
    try {
      val display = DisplayInfo.display(a) ?: return
      val cur = display.mode
      val modes = display.supportedModes.filter { it.physicalWidth == cur.physicalWidth && it.physicalHeight == cur.physicalHeight }
      val best = modes.filter { it.refreshRate >= fps - 1f }.minByOrNull { it.refreshRate } ?: modes.maxByOrNull { it.refreshRate }
      if (best != null) {
        val lp = a.window.attributes
        if (lp.preferredDisplayModeId != best.modeId) {
          lp.preferredDisplayModeId = best.modeId
          a.window.attributes = lp
        }
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val surface = surfaceView.holder.surface
        if (surface != null && surface.isValid) surface.setFrameRate(fps, Surface.FRAME_RATE_COMPATIBILITY_DEFAULT)
      }
    } catch (_: Exception) {
      // Some devices refuse mode changes; playback still works at the current rate.
    }
  }

  private fun resetDisplayRate() {
    val a = activity() ?: return
    try {
      val lp = a.window.attributes
      if (lp.preferredDisplayModeId != 0) {
        lp.preferredDisplayModeId = 0
        a.window.attributes = lp
      }
    } catch (_: Exception) {
    }
  }

  private val surfaceCallback = object : SurfaceHolder.Callback {
    override fun surfaceCreated(holder: SurfaceHolder) {
      applyDisplayRate()
    }

    override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) = Unit

    override fun surfaceDestroyed(holder: SurfaceHolder) = Unit
  }

  // endregion

  // region Lifecycle

  // Runs after every property above is initialised (listeners included).
  init {
    setBackgroundColor(Color.BLACK)
    aspect.addView(surfaceView, FrameLayout.LayoutParams(MATCH, MATCH))
    container.addView(aspect, FrameLayout.LayoutParams(MATCH, MATCH, Gravity.CENTER))
    subtitleView.setUserDefaultStyle()
    subtitleView.setUserDefaultTextSize()
    container.addView(subtitleView, FrameLayout.LayoutParams(MATCH, MATCH))
    addView(container, LinearLayout.LayoutParams(MATCH, MATCH))

    player.setVideoSurfaceView(surfaceView)
    player.addListener(listener)
    surfaceView.holder.addCallback(surfaceCallback)
    active = WeakReference(this)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    active = WeakReference(this)
    handler.removeCallbacks(ticker)
    handler.post(ticker)
    applyDisplayRate()
    updatePipParams()
    (activity() as? ComponentActivity)?.let {
      it.addOnPictureInPictureModeChangedListener(pipListener)
      pipActivity = it
    }
    if (controller == null) {
      val token = SessionToken(context, ComponentName(context, GlidePlaybackService::class.java))
      controller = MediaController.Builder(context, token).buildAsync()
    }
  }

  override fun onDetachedFromWindow() {
    handler.removeCallbacks(ticker)
    pipActivity?.removeOnPictureInPictureModeChangedListener(pipListener)
    pipActivity = null
    super.onDetachedFromWindow()
  }

  fun release() {
    if (released) return
    released = true
    handler.removeCallbacksAndMessages(null)
    pipActivity?.removeOnPictureInPictureModeChangedListener(pipListener)
    pipActivity = null
    surfaceView.holder.removeCallback(surfaceCallback)
    player.removeListener(listener)
    player.clearVideoSurfaceView(surfaceView)
    // A newer player screen may already be using the shared player; only the active view stops it.
    val isActive = active?.get() === this
    if (isActive) {
      player.stop()
      player.clearMediaItems()
      PlayerHolder.timing.audioDelayUs = 0
      PlayerHolder.timing.subtitleDelayUs = 0
    }
    settings.compare = false
    settings.showVectors = false
    resetDisplayRate()
    activity()?.let { a ->
      if (pipSupported(a) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        try {
          a.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(false).build())
        } catch (_: Exception) {
        }
      }
    }
    controller?.let { MediaController.releaseFuture(it) }
    controller = null
    if (active?.get() === this) active = null
  }

  // endregion

  companion object {
    private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT

    /** The player view on screen, for activity callbacks (Home pressed, app backgrounded). */
    internal var active: WeakReference<GlidePlayerView>? = null
  }
}

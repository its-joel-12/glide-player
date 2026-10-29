package expo.modules.glide

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import expo.modules.glide.memc.MemcEffect
import expo.modules.glide.memc.MemcSettings
import expo.modules.glide.memc.MemcStats

/**
 * One player for the whole app, shared by the player screen and the background playback
 * service (lock-screen and notification controls).
 */
@OptIn(UnstableApi::class)
internal object PlayerHolder {
  val settings = MemcSettings()
  val stats = MemcStats()

  private var player: ExoPlayer? = null
  var session: MediaSession? = null
    private set

  /** False while the current player runs without the smoothing pipeline (fallback for videos it can't handle). */
  var effectsEnabled = true
    private set

  /**
   * The shared player, with or without the smoothing effect. Media3 sets up its effect pipeline
   * once per player, so switching means building a new player (the media session follows it).
   */
  fun obtain(context: Context, withEffects: Boolean = true): ExoPlayer {
    val existing = player
    if (existing != null && effectsEnabled == withEffects) return existing
    val app = context.applicationContext
    val p = build(app, withEffects)
    existing?.release()
    player = p
    effectsEnabled = withEffects

    val current = session
    if (current != null) {
      current.player = p
    } else {
      val builder = MediaSession.Builder(app, p).setId("glide-player")
      app.packageManager.getLaunchIntentForPackage(app.packageName)?.let { launch ->
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        builder.setSessionActivity(
          PendingIntent.getActivity(app, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        )
      }
      session = builder.build()
    }
    return p
  }

  private fun build(app: Context, withEffects: Boolean): ExoPlayer {
    val renderers = DefaultRenderersFactory(app).setEnableDecoderFallback(true)
    val p = ExoPlayer.Builder(app, renderers)
      .setAudioAttributes(
        AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
        /* handleAudioFocus= */ true,
      )
      .setHandleAudioBecomingNoisy(true)
      // We pick the screen refresh rate ourselves (the smoothed output is faster than the video).
      .setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_OFF)
      .setSeekBackIncrementMs(10_000)
      .setSeekForwardIncrementMs(10_000)
      .build()
    if (withEffects) p.setVideoEffects(listOf<Effect>(MemcEffect(settings, stats, isExport = false)))
    return p
  }

  /**
   * Re-shows the current (paused) frame through the effect, e.g. after toggling split view.
   * (VideoFrameProcessor.REDRAW needs a replay cache ExoPlayer doesn't turn on, so seek in place.)
   */
  fun redraw() {
    player?.let { it.seekTo(it.currentPosition) }
  }

  fun pause() {
    player?.pause()
  }
}

/** Keeps sound and lock-screen controls going while the app is in the background. */
@OptIn(UnstableApi::class)
class GlidePlaybackService : MediaSessionService() {
  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = PlayerHolder.session

  override fun onTaskRemoved(rootIntent: Intent?) {
    PlayerHolder.pause()
    stopSelf()
  }
}

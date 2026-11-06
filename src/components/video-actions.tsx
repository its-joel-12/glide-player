import { shareVideo } from 'glide-engine';
import { Alert, Platform } from 'react-native';

import { Sheet, SheetOption } from '@/components/sheet';
import { formatResolution, formatTime } from '@/lib/format';
import { deleteVideos } from '@/lib/library';
import { openExport, openPlayer, type VideoRef } from '@/lib/navigation';
import { clearResume, clearResumeMany, getResume, startPosition } from '@/lib/resume';
import { isWatched, setWatched, setWatchedMany } from '@/lib/watched';

/** Android 11+ shows its own "Allow Glide to delete this video?" dialog; older versions don't. */
const systemConfirmsDelete = Platform.OS === 'android' && Number(Platform.Version) >= 30;

/** Deletes videos from the phone after one confirmation (the system's on Android 11+, ours before). */
export async function confirmAndDelete(videos: VideoRef[], onDeleted?: (gone: VideoRef[]) => void) {
  if (!videos.length) return;
  const one = videos.length === 1;
  if (!systemConfirmsDelete) {
    const ok = await new Promise<boolean>((resolve) =>
      Alert.alert(one ? 'Delete this video?' : `Delete ${videos.length} videos?`, one ? `“${videos[0].title}” will be removed from your phone.` : 'They will be removed from your phone.', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ]),
    );
    if (!ok) return;
  }
  try {
    await deleteVideos(videos);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Saying no in the system dialog lands here too: that isn't an error.
    if (!/cancel|denied|declin|not granted/i.test(message)) Alert.alert(one ? 'Couldn’t delete the video' : 'Couldn’t delete the videos', message);
    return;
  }
  const ids = videos.map((v) => v.id);
  clearResumeMany(ids);
  setWatchedMany(ids, false);
  onDeleted?.(videos);
}

/**
 * Long-press (or ⋮) menu for a video. [inContinueWatching]: opened from the "Continue watching"
 * row, which adds a plain "Remove from Continue watching".
 */
export function VideoActions({
  video,
  onClose,
  onDeleted,
  inContinueWatching,
}: {
  video: VideoRef | null;
  onClose: () => void;
  onDeleted?: (v: VideoRef) => void;
  inContinueWatching?: boolean;
}) {
  const resumeAt = video ? startPosition(getResume(video.id)) : 0;
  const watched = video ? isWatched(video.id) : false;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const detail = video ? [formatResolution(video.width, video.height), video.durationMs ? formatTime(video.durationMs) : ''].filter(Boolean).join(' · ') : '';
  return (
    <Sheet visible={!!video} title={video?.title} onClose={onClose}>
      {video ? (
        <>
          <SheetOption label={resumeAt > 0 ? `Continue from ${formatTime(resumeAt)}` : 'Play'} detail={detail} onPress={run(() => openPlayer(video))} />
          {resumeAt > 0 ? <SheetOption label="Play from the start" onPress={run(() => openPlayer(video, { fromStart: true }))} /> : null}
          <SheetOption
            label={watched ? 'Mark as not watched' : 'Mark as watched'}
            detail={!watched && resumeAt > 0 ? 'Ticks it and takes it out of Continue watching' : undefined}
            onPress={run(() => {
              setWatched(video.id, !watched);
              if (!watched) clearResume(video.id);
            })}
          />
          {resumeAt > 0 ? (
            <SheetOption
              label={inContinueWatching ? 'Remove from Continue watching' : 'Mark as not started'}
              detail={inContinueWatching ? 'Forgets where you stopped; it starts from the beginning next time' : 'Removes it from Continue watching'}
              onPress={run(() => clearResume(video.id))}
            />
          ) : null}
          <SheetOption
            label="Share"
            detail="Send it with another app"
            onPress={run(() => void shareVideo(video.uri, video.title).catch((e: unknown) => Alert.alert('Couldn’t share the video', e instanceof Error ? e.message : String(e))))}
          />
          <SheetOption
            label="Save smooth, slow-motion or sharper copy"
            detail="Optical-flow retime (60/120 fps, 2–8× slow motion) or AI upscaling (2×/4×)"
            onPress={run(() => openExport(video))}
          />
          <SheetOption label="Delete from phone" detail="Removes the file itself" onPress={run(() => void confirmAndDelete([video], (gone) => onDeleted?.(gone[0])))} />
        </>
      ) : null}
    </Sheet>
  );
}

import { Sheet, SheetOption } from '@/components/sheet';
import { formatResolution, formatTime } from '@/lib/format';
import { openExport, openPlayer, type VideoRef } from '@/lib/navigation';
import { clearResume, getResume, startPosition } from '@/lib/resume';

/** Long-press menu for a video. */
export function VideoActions({ video, onClose }: { video: VideoRef | null; onClose: () => void }) {
  const resumeAt = video ? startPosition(getResume(video.id)) : 0;
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
            label="Save smooth or slow-motion copy"
            detail="Optical-flow retime: 60/120 fps or 2–8× slow motion"
            onPress={run(() => openExport(video))}
          />
          {resumeAt > 0 ? <SheetOption label="Mark as not started" onPress={run(() => clearResume(video.id))} /> : null}
        </>
      ) : null}
    </Sheet>
  );
}

/**
 * `/reel/new` — upload (SPEC §5.2): `.mp4` / `.mov` / `.webm`, `readVideoMeta` → a file over 60 s (+ the one shared
 * tolerance) is refused BEFORE upload with "Reels max out at 60 seconds. This one is {m:ss}."; oversize files are
 * refused with the size copy; cover = first frame; caption ≤ 150; Campus / Global; public `ComposerModeBanner
 * verb="Posting"`; progress bar; on success the reel leads the campus feed + own grid. G2 location note shown.
 */
import { useEffect, useRef, useState, type ChangeEvent, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clapperboard, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import type { FeedScope } from '@shared/core';
import { LIMITS } from '@shared/core';
import { Button, PageHeader, ProgressBar, Screen, Textarea } from '@/ui';
import { CampusScopeToggle, ComposerGuard, ComposerModeBanner } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { showModerationNotice } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { readVideoMeta, uploadImage, uploadVideo, type VideoMeta } from '@/lib/upload';
import { createReel, insertNewReel, onWriteError } from './api';

const MAX_MS = LIMITS.reelMaxDurationMs + LIMITS.reelDurationToleranceMs;
const ACCEPT = 'video/mp4,video/quicktime,video/webm';
const LOCATION_NOTE = 'Videos may include location data from your camera. Turn off location tagging in your camera settings.';

function mmss(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

type Phase = 'idle' | 'reading' | 'ready' | 'uploading' | 'posting';

export const UploadPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  useScreenView('reel_new');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<VideoMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<FeedScope>('campus');
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reset = () => {
    setFile(null);
    setMeta(null);
    setPreviewFailed(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPhase('idle');
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    setError(null);
    if (picked.size > LIMITS.videoMaxBytes) {
      setError(`That file is ${mb(picked.size)} MB. The limit is ${mb(LIMITS.videoMaxBytes)} MB.`);
      reset();
      return;
    }
    setPhase('reading');
    setFile(picked);
    setPreviewFailed(false);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(picked));
    try {
      const m = await readVideoMeta(picked);
      if (m.durationMs > MAX_MS) {
        setError(`Reels max out at 60 seconds. This one is ${mmss(m.durationMs)}.`);
        reset();
        return;
      }
      setMeta(m);
    } catch {
      // The browser cannot decode this file (e.g. an HEVC .mov): the server still probes the container for the
      // 60 s rule and the feed falls back to the poster player (DECISIONS D4.2).
      setMeta(null);
      setPreviewFailed(true);
    }
    setPhase('ready');
  };

  const submit = async () => {
    if (!file || phase === 'uploading' || phase === 'posting') return;
    setError(null);
    setProgress(0);
    setPhase('uploading');
    try {
      const video = await uploadVideo(file, meta ? { durationMs: meta.durationMs, width: meta.width, height: meta.height } : { durationMs: 0, width: 0, height: 0 }, setProgress);
      let posterUploadId: string | null = null;
      if (meta?.posterBlob) {
        try {
          const poster = await uploadImage(new File([meta.posterBlob], 'cover.jpg', { type: 'image/jpeg' }), { kind: 'image' });
          posterUploadId = poster.id;
        } catch {
          posterUploadId = null; // the feed generates a poster when there is none
        }
      }
      setPhase('posting');
      const { moderation, ...reel } = await createReel({ videoUploadId: video.id, posterUploadId, caption: caption.trim(), visibility });
      insertNewReel(reel);
      showModerationNotice(moderation);
      toast.success(reel.status === 'held' ? 'Reel submitted' : 'Reel posted');
      navigate(routes.home('reels'), { replace: true });
    } catch (e) {
      setPhase('ready');
      const err = e as { status?: number; code?: string; message?: string };
      if (err?.status === 422 && err.code === 'validation_failed') {
        setError(err.message ?? 'Reels max out at 60 seconds.');
        return;
      }
      if (err?.status === 413 || err?.status === 415) {
        setError(err.message ?? "That file can't be uploaded.");
        return;
      }
      onWriteError(e);
    }
  };

  const busy = phase === 'uploading' || phase === 'posting';
  const canPost = Boolean(file) && phase === 'ready';

  const footer = (
    <ComposerGuard scope="public" className="mx-4 my-3">
      <div className="flex flex-col gap-3 px-4 pt-3 pb-1">
        {busy ? (
          <div className="flex flex-col gap-1.5">
            <ProgressBar value={phase === 'uploading' ? progress : undefined} aria-label="Upload progress" />
            <span className="type-caption text-ink-3">{phase === 'uploading' ? `Uploading · ${Math.round(progress * 100)}%` : 'Posting…'}</span>
          </div>
        ) : null}
        <Button variant="hero" size="lg" fullWidth loading={busy} disabled={!canPost} onClick={() => void submit()}>
          Post reel
        </Button>
      </div>
    </ComposerGuard>
  );

  return (
    <Screen header={<PageHeader title="New reel" back mode="compact" />} footer={footer}>
      <div className="flex flex-col gap-4 px-4 pt-2">
        <ComposerModeBanner mode="public" verb="Posting" note="Visible on your public profile" />

        <input ref={inputRef} type="file" accept={ACCEPT} onChange={(e) => void onPick(e)} className="sr-only" tabIndex={-1} aria-hidden />

        {file && previewUrl ? (
          <div className="flex flex-col items-center gap-3">
            <div className="relative mx-auto aspect-[9/16] h-[56cqh] max-w-full overflow-hidden rounded-lg bg-surface-2">
              {!previewFailed ? (
                <video src={previewUrl} muted loop playsInline autoPlay className="size-full object-cover" onError={() => setPreviewFailed(true)} />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Clapperboard size={28} strokeWidth={1.75} className="text-accent-ink" aria-hidden />
                  <p className="type-footnote text-ink-2">This browser can't preview the file, but it can still be posted.</p>
                </div>
              )}
              {meta ? (
                <span className="absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 type-caption text-white backdrop-blur-sm">{mmss(meta.durationMs)}</span>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" leftIcon={RefreshCw} onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose a different video
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={phase === 'reading'}
            className={cn(
              'press mx-auto flex aspect-[9/16] h-[48cqh] max-w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface-1 px-6 text-center',
              'hover:border-accent-line hover:bg-surface-2',
            )}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <Clapperboard size={26} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="type-headline text-ink">{phase === 'reading' ? 'Reading your video…' : 'Choose a video'}</span>
            <span className="type-footnote text-ink-3">Vertical, up to 60 seconds · .mp4, .mov or .webm · up to {mb(LIMITS.videoMaxBytes)} MB</span>
          </button>
        )}

        {error ? (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-danger/45 bg-danger-soft px-3.5 py-3 type-footnote text-ink">
            <TriangleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <Textarea
          variant="bare"
          label="Caption"
          placeholder="Say something about it…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={LIMITS.reelCaption}
          showCount
          minRows={2}
          maxRows={5}
          disabled={busy}
          className="rounded-lg border border-line bg-surface-1 px-3.5 py-2.5"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="type-label-sm text-ink-2">Who can see it</span>
          <CampusScopeToggle value={visibility} onChange={setVisibility} size="sm" />
        </div>
        <p className="type-caption text-ink-3">
          {visibility === 'campus' ? `Only ${me.university.shortName} students see this reel.` : 'Students at every campus can see this reel.'}
        </p>

        <div className="flex items-start gap-2.5 rounded-lg border border-line-subtle bg-surface-1 px-3.5 py-3">
          <Info size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-info" aria-hidden />
          <p className="type-footnote text-ink-2">{LOCATION_NOTE}</p>
        </div>
      </div>
    </Screen>
  );
};

/**
 * One reel (design §6.5 / §7.2): the `<video>` (or the animated poster fallback), bottom-left identity + caption,
 * the right rail (like · comment · share · more — no Save, SPEC §2.3), a 2px progress bar, tap = pause / play with
 * a fading glyph, double-tap = like burst at the touch point. Only reels within ±1 of the active one mount a
 * `<video>`; the rest render their poster. Exactly one reel plays at a time (`playing` is owned by the pane).
 */
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Ellipsis, EyeOff, Heart, MessageCircle, Pause, Play, School, Send, Trash2 } from 'lucide-react';
import type { Reel } from '@shared/reels';
import { Chip, Dialog, IconButton } from '@/ui';
import { ContentStatusChip } from '@/lib/moderation';
import { FollowButton, OverflowMenu, TimeAgo, UserAvatar, UserListSheet } from '@/components';
import { cn } from '@/lib/cn';
import { useDoubleTap } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { formatCount } from '@/lib/format';
import { openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { errorMessage } from '@/lib/api';
import { deleteReel, dropReel, notInterested, patchReel, recordView, reelKeys, useToggleReelLike } from './api';
import { PosterFallback } from './PosterFallback';

export interface ReelCardProps {
  reel: Reel;
  /** Mount the `<video>` (within the ±1 preload window). */
  mounted: boolean;
  /** Active reel + active pane + visible document → play. */
  playing: boolean;
  muted: boolean;
  /** Unmuted autoplay was refused by the browser → the pane flips back to muted. */
  onAutoplayBlocked(): void;
  onOpenComments(reel: Reel): void;
  /** The reel left the viewer's world (not interested / deleted / reported). */
  onRemoved?(reel: Reel): void;
  /** Bottom inset for the overlays: nav clearance in the pane, safe-bottom on the deep-link page. */
  bottomInset: string;
  /** Increments when the pane wants this (active) reel to toggle pause (Space key). */
  toggleSignal?: number;
  className?: string;
}

interface Burst {
  id: number;
  x: number;
  y: number;
}

const COMPLETE_SLACK_S = 0.35;
const GLYPH_MS = 420;

export const ReelCard = memo(function ReelCard({
  reel, mounted, playing, muted, onAutoplayBlocked, onOpenComments, onRemoved, bottomInset, toggleSignal = 0, className,
}: ReelCardProps) {
  const reduced = useReducedMotionPref();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const viewed = useRef(false);
  const completed = useRef(false);
  const glyphTimer = useRef<number | null>(null);
  const burstSeq = useRef(0);

  const [userPaused, setUserPaused] = useState(false);
  const [failed, setFailed] = useState(false);
  const [glyph, setGlyph] = useState<'play' | 'pause' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);

  const like = useToggleReelLike();
  const isSelf = reel.viewer.isSelf;
  const shouldPlay = playing && !userPaused;
  const usingFallback = failed || !mounted;

  /* ---------------------------------------------------------------- play / pause */

  useEffect(() => {
    const v = videoRef.current;
    if (!v || failed) return;
    if (shouldPlay) {
      v.muted = muted;
      const p = v.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: unknown) => {
          const name = (err as { name?: string } | null)?.name;
          if (name === 'NotAllowedError' && !v.muted) {
            v.muted = true;
            onAutoplayBlocked();
            v.play().catch(() => undefined);
          }
        });
      }
    } else {
      v.pause();
    }
  }, [shouldPlay, muted, failed, mounted, onAutoplayBlocked]);

  // leaving the reel clears a manual pause so coming back plays again
  useEffect(() => {
    if (!playing) setUserPaused(false);
  }, [playing]);

  // one view per reel per session, sent the first time it plays
  useEffect(() => {
    if (playing && !viewed.current) {
      viewed.current = true;
      recordView(reel.id);
    }
  }, [playing, reel.id]);

  useEffect(() => () => {
    if (glyphTimer.current !== null) window.clearTimeout(glyphTimer.current);
  }, []);

  /* ---------------------------------------------------------------- fallback faux progress */

  useEffect(() => {
    if (!usingFallback || !shouldPlay || reduced) return;
    const bar = barRef.current;
    if (!bar) return;
    const duration = Math.max(3000, reel.durationMs || 8000);
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = ((t - start) % duration) / duration;
      bar.style.transform = `scaleX(${p})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [usingFallback, shouldPlay, reduced, reel.durationMs]);

  /* ---------------------------------------------------------------- video events */

  const onTimeUpdate = useCallback(
    (e: SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      const bar = barRef.current;
      if (bar && Number.isFinite(v.duration) && v.duration > 0) bar.style.transform = `scaleX(${v.currentTime / v.duration})`;
      if (!completed.current && Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - COMPLETE_SLACK_S) {
        completed.current = true;
        recordView(reel.id, true);
      }
    },
    [reel.id],
  );

  const onError = useCallback(() => setFailed(true), []);

  /* ---------------------------------------------------------------- taps */

  const showGlyph = (kind: 'play' | 'pause') => {
    setGlyph(kind);
    if (glyphTimer.current !== null) window.clearTimeout(glyphTimer.current);
    glyphTimer.current = window.setTimeout(() => setGlyph(null), GLYPH_MS);
  };

  const togglePause = useCallback(() => {
    setUserPaused((p) => {
      showGlyph(p ? 'play' : 'pause');
      return !p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const burstAt = useCallback(
    (e: MouseEvent<Element>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const id = ++burstSeq.current;
      setBursts((b) => [...b, { id, x: e.clientX - rect.left, y: e.clientY - rect.top }]);
      window.setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 900);
      try {
        navigator.vibrate?.(10);
      } catch {
        /* unsupported */
      }
      if (!reel.viewer.liked && !like.isPending) like.mutate(reel);
    },
    [reel, like],
  );

  const onStageClick = useDoubleTap<Element>(togglePause, burstAt);

  // keyboard Space from the pane
  const lastSignal = useRef(toggleSignal);
  useEffect(() => {
    if (toggleSignal === lastSignal.current) return;
    lastSignal.current = toggleSignal;
    if (playing || userPaused) togglePause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toggleSignal]);

  /* ---------------------------------------------------------------- actions */

  const share = () =>
    openShare({
      card: { kind: 'reel', id: reel.id },
      url: routes.reel(reel.id),
      title: reel.caption.trim() || `Reel by @${reel.author.handle}`,
      text: reel.caption.trim() || undefined,
    });

  const hide = async () => {
    try {
      await notInterested(reel.id);
      dropReel(reel.id);
      onRemoved?.(reel);
      toast.success("Got it — you'll see fewer like this.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const remove = async () => {
    try {
      await deleteReel(reel.id);
      dropReel(reel.id);
      onRemoved?.(reel);
      toast.success('Reel deleted');
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };

  const caption = reel.caption.trim();

  return (
    <article
      className={cn('relative size-full select-none overflow-hidden bg-canvas text-white', className)}
      aria-label={`Reel by @${reel.author.handle}`}
      data-reel-id={reel.id}
    >
      {/* stage */}
      {mounted && !failed ? (
        <video
          ref={videoRef}
          src={reel.videoUrl}
          poster={reel.posterUrl ?? undefined}
          playsInline
          muted={muted}
          loop
          preload={playing ? 'auto' : 'metadata'}
          disablePictureInPicture
          className="absolute inset-0 size-full object-cover"
          onTimeUpdate={onTimeUpdate}
          onError={onError}
        />
      ) : (
        <PosterFallback seed={reel.id} posterUrl={reel.posterUrl} playing={shouldPlay} />
      )}

      {/* tap layer */}
      <button
        type="button"
        aria-label={userPaused ? 'Play' : 'Pause'}
        onClick={onStageClick}
        className="absolute inset-0 z-[1] cursor-default focus-visible:outline-none"
      />

      {/* scrims */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-[45%] bg-scrim-bottom" />

      {/* pause / play glyph */}
      <AnimatePresence>
        {glyph ? (
          <motion.div
            key={glyph}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center"
            initial={{ opacity: 0, scale: reduced ? 1 : 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 1.15 }}
            transition={{ duration: 0.18 }}
          >
            <span className="flex size-20 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
              {glyph === 'play' ? <Play size={36} fill="currentColor" aria-hidden /> : <Pause size={36} fill="currentColor" aria-hidden />}
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* like bursts */}
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.span
            key={b.id}
            aria-hidden
            className="pointer-events-none absolute z-[3] -ml-9 -mt-9 text-love drop-shadow-[0_6px_18px_rgb(0_0_0/0.45)]"
            style={{ left: b.x, top: b.y }}
            initial={{ scale: 0, opacity: 0, rotate: -12 }}
            animate={{ scale: reduced ? 1 : [0, 1.35, 1], opacity: [0, 1, 1], rotate: reduced ? 0 : [-12, 6, 0] }}
            exit={{ scale: 1.4, opacity: 0, y: -24 }}
            transition={reduced ? { duration: 0.15 } : { ...spring.bouncy, duration: 0.45 }}
          >
            <Heart size={72} fill="currentColor" strokeWidth={0} />
          </motion.span>
        ))}
      </AnimatePresence>

      {/* bottom-left: identity + caption */}
      <div className="pointer-events-none absolute left-4 right-20 z-[4] flex flex-col gap-2" style={{ bottom: `calc(${bottomInset} + 14px)` }}>
        <div className="pointer-events-auto flex items-center gap-2.5">
          <UserAvatar user={reel.author} size="md" className="ring-2 ring-white/20" />
          <Link
            to={routes.profile(reel.author.handle)}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 truncate type-headline text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.4)]"
          >
            @{reel.author.handle}
          </Link>
          {!isSelf ? (
            <FollowButton
              userId={reel.author.id}
              initialFollowing={reel.viewer.isFollowingAuthor}
              size="sm"
              onChange={(r) => patchReel(reel.id, (x) => ({ ...x, viewer: { ...x.viewer, isFollowingAuthor: r.isFollowing } }))}
              className="ml-1"
            />
          ) : null}
        </div>
        {caption ? (
          <div className="pointer-events-auto flex flex-col items-start">
            <p className={cn('type-body text-white/95 [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]', !expanded && 'line-clamp-2')}>{caption}</p>
            {caption.length > 80 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded((x) => !x);
                }}
                className="-my-2 min-h-11 min-w-11 text-left type-label-sm text-white/75 [text-shadow:0_1px_2px_rgb(0_0_0/0.45)]"
                aria-expanded={expanded}
              >
                {expanded ? 'less' : 'more'}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <Chip variant="tag" size="sm" leftIcon={School} className="border-white/15 bg-white/12 text-white backdrop-blur-sm">
            {reel.author.universityShortName}
          </Chip>
          <TimeAgo ts={reel.createdAt} className="type-caption text-white/75" />
          {isSelf && reel.status !== 'active' ? <ContentStatusChip status={reel.status} /> : null}
        </div>
      </div>

      {/* right rail */}
      <div className="absolute right-1 z-[4] flex flex-col items-center gap-3" style={{ bottom: `calc(${bottomInset} + 18px)` }} onClick={(e) => e.stopPropagation()}>
        <RailButton
          icon={Heart}
          label={reel.viewer.liked ? 'Unlike' : 'Like'}
          count={reel.likeCount}
          active={reel.viewer.liked}
          activeTone="love"
          onClick={() => like.mutate(reel)}
          onCountClick={reel.likeCount > 0 ? () => setLikersOpen(true) : undefined}
          countLabel="See who liked this"
        />
        <RailButton icon={MessageCircle} label="Comments" count={reel.commentCount} onClick={() => onOpenComments(reel)} />
        <RailButton icon={Send} label="Share" onClick={share} />
        <RailButton icon={Ellipsis} label="More" onClick={() => setMenuOpen(true)} />
      </div>

      {/* progress */}
      <div aria-hidden className="absolute inset-x-0 z-[4] h-0.5 bg-white/25" style={{ bottom: `calc(${bottomInset} - 8px)` }}>
        <div ref={barRef} className="h-full w-full origin-left bg-white" style={{ transform: 'scaleX(0)' }} />
      </div>

      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={!isSelf ? [{ icon: EyeOff, label: 'Not interested', onSelect: () => void hide() }] : undefined}
        share={{ card: { kind: 'reel', id: reel.id }, url: routes.reel(reel.id), title: caption || `Reel by @${reel.author.handle}` }}
        report={{ entityType: 'reel', entityId: reel.id, author: isSelf ? null : reel.author, onReported: () => { dropReel(reel.id); onRemoved?.(reel); } }}
        blockUser={isSelf ? null : reel.author}
        onDelete={isSelf ? () => setConfirmDelete(true) : undefined}
        deleteLabel="Delete reel"
      />
      <UserListSheet open={likersOpen} onOpenChange={setLikersOpen} title="Likes" path={`/reels/${encodeURIComponent(reel.id)}/likers`} queryKey={[...reelKeys.likers(reel.id)]} emptyTitle="No likes yet" />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this reel?"
        description="It disappears from every feed and your profile. This can't be undone."
        icon={Trash2}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </article>
  );
});

interface RailButtonProps {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  activeTone?: 'accent' | 'love';
  onClick(): void;
  /** Makes the count a button of its own (likers list). */
  onCountClick?(): void;
  countLabel?: string;
}

function RailButton({ icon, label, count, active, activeTone, onClick, onCountClick, countLabel }: RailButtonProps) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <IconButton
        icon={icon}
        aria-label={label}
        size="lg"
        variant="ghost"
        active={active}
        activeTone={activeTone}
        onClick={onClick}
        className={cn(
          'text-white drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)] hover:bg-white/10 active:bg-white/15 [&_svg]:size-7',
          active && activeTone === 'love' && 'text-love',
        )}
      />
      {count !== undefined && onCountClick ? (
        <button
          type="button"
          onClick={onCountClick}
          aria-label={`${countLabel ?? label} (${count})`}
          className="press -mt-1 -mb-3 min-h-11 min-w-11 rounded-full px-1 type-caption tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]"
        >
          {formatCount(count)}
        </button>
      ) : count !== undefined ? (
        <span className="type-caption tabular-nums text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.5)]" aria-hidden>
          {formatCount(count)}
        </span>
      ) : null}
    </div>
  );
}

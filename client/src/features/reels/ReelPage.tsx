/**
 * `/reel/:id` — the single-reel deep link (shared cards, notifications). Same player, own top controls
 * (back · mute), `?comments=1` opens the comments sheet; nav hidden.
 */
import { useCallback, useEffect, useState, type FC } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Clapperboard, Volume2, VolumeX } from 'lucide-react';
import { EmptyState, ErrorState, IconButton, Screen } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { isApiError } from '@/lib/api';
import { routes } from '@/lib/links';
import { useReel } from './api';
import { CommentsSheet } from './CommentsSheet';
import { ReelCard } from './ReelCard';
import { ReelSkeleton } from './ReelsPane';
import { ensureReelsStoreReset, useReelsStore } from './store';

const TOP_INSET = 'calc(var(--safe-top) + 8px)';
const BOTTOM_INSET = 'calc(16px + var(--safe-bottom))';

export const ReelPage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const muted = useReelsStore((s) => s.muted);
  const setMuted = useReelsStore((s) => s.setMuted);
  const toggleMuted = useReelsStore((s) => s.toggleMuted);
  const query = useReel(id);
  const reel = query.data;
  useScreenView('reel', { reelId: id ?? '' });
  useEffect(() => ensureReelsStoreReset(), []);

  const [commentsOpen, setCommentsOpen] = useState(params.get('comments') === '1');
  useEffect(() => {
    if (params.get('comments') === '1') setCommentsOpen(true);
  }, [params]);
  const onCommentsChange = useCallback(
    (open: boolean) => {
      setCommentsOpen(open);
      if (!open && params.get('comments')) {
        const next = new URLSearchParams(params);
        next.delete('comments');
        setParams(next, { replace: true });
      }
    },
    [params, setParams],
  );

  const back = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(routes.home('reels'), { replace: true });
  };
  const onAutoplayBlocked = useCallback(() => setMuted(true), [setMuted]);

  let body: React.ReactNode;
  if (query.isLoading) body = <ReelSkeleton />;
  else if (query.isError || !reel) {
    const gone = isApiError(query.error) && query.error.status === 404;
    body = (
      <div className="absolute inset-0 flex items-center justify-center px-4">
        {gone ? (
          <EmptyState icon={Clapperboard} title="This reel isn't available" description="It may have been deleted, or it's not visible to you." action={{ label: 'Back to Reels', onClick: () => navigate(routes.home('reels'), { replace: true }) }} />
        ) : (
          <ErrorState title="Couldn't load this reel" error={query.error} onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  } else {
    body = (
      <ReelCard
        reel={reel}
        mounted
        playing
        muted={muted}
        onAutoplayBlocked={onAutoplayBlocked}
        onOpenComments={() => setCommentsOpen(true)}
        onRemoved={back}
        bottomInset={BOTTOM_INSET}
      />
    );
  }

  return (
    <Screen bleed>
      <div className="absolute inset-0 overflow-hidden bg-canvas">
        {body}
        <div className="pointer-events-none absolute inset-x-2 z-[6] flex items-center justify-between" style={{ top: TOP_INSET }}>
          <IconButton icon={ChevronLeft} aria-label="Back" variant="glass" onClick={back} className="pointer-events-auto" />
          {reel ? (
            <button
              type="button"
              onClick={toggleMuted}
              aria-pressed={!muted}
              aria-label={muted ? 'Tap for sound' : 'Mute'}
              className="press pointer-events-auto flex h-9 min-w-9 items-center gap-1.5 rounded-full bg-black/40 px-2.5 text-white backdrop-blur-md"
            >
              {muted ? <VolumeX size={18} strokeWidth={2} aria-hidden /> : <Volume2 size={18} strokeWidth={2} aria-hidden />}
              {muted ? <span className="type-caption">Tap for sound</span> : null}
            </button>
          ) : null}
        </div>
        <CommentsSheet reel={reel ?? null} open={commentsOpen && Boolean(reel)} onOpenChange={onCommentsChange} />
      </div>
    </Screen>
  );
};

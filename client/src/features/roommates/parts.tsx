/**
 * Shared roommate pieces: compat ring, the browse card (+ skeleton), the "answer 8 questions" banner, the safety-first
 * message flow (opener draft + safety sheet before first contact). Every card carries Report + Block via OverflowMenu.
 */
import { useState, type FC, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Bookmark, Ellipsis, Home, MessageCircle, Search, Sparkles } from 'lucide-react';
import type { Id, UserSummary } from '@shared/core';
import { COMPAT_GREAT, ROOMMATE_MODE_LABEL, ROOMMATE_SAFETY, type Compatibility, type RoommateCard, type RoommateMode } from '@shared/roommates';
import { Badge, Button, Card, Chip, IconButton, ProgressRing, Sheet, Skeleton } from '@/ui';
import { MediaBox, OverflowMenu, UserAvatar } from '@/components';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { openDm } from '@/lib/dm';
import { formatPrice } from '@/lib/format';
import { routes } from '@/lib/links';
import { spring, useReducedMotionPref } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { absoluteUrl } from '@/lib/share';
import { formatMoveIn, moveInMonthName } from './filters';

/* ------------------------------------------------------------------ compat ring */

export const CompatRing: FC<{ compat: Compatibility | null; size?: 40 | 64 | 96; className?: string }> = ({ compat, size = 64, className }) => {
  const reduced = useReducedMotionPref();
  const pct = compat?.pct ?? null;
  const great = pct !== null && pct >= COMPAT_GREAT;
  const label = pct === null ? <span className="type-label text-ink-3">—</span> : <span className={cn(size === 96 ? 'type-title-3' : 'type-label', 'tabular-nums')}>{pct}%</span>;
  const ring = <ProgressRing value={pct === null ? 0 : pct / 100} size={size} label={label} animate={pct !== null} aria-label={pct === null ? 'Match unknown' : `${pct}% match`} />;
  // ≥ 85 % gets the one allowed `bouncy` pop (celebration).
  if (great && !reduced) {
    return (
      <motion.div className={className} initial={{ scale: 0.82 }} animate={{ scale: 1 }} transition={{ ...spring.bouncy, delay: 0.25 }}>
        {ring}
      </motion.div>
    );
  }
  return <div className={className}>{ring}</div>;
};

/* ------------------------------------------------------------------ mode chip */

export const ModeBadge: FC<{ mode: RoommateMode; className?: string }> = ({ mode, className }) => (
  <Badge variant="soft" tone={mode === 'have' ? 'success' : 'info'} className={className}>
    {mode === 'have' ? <Home size={11} strokeWidth={2} aria-hidden /> : <Search size={11} strokeWidth={2} aria-hidden />} {ROOMMATE_MODE_LABEL[mode]}
  </Badge>
);

/* ------------------------------------------------------------------ cover */

/** 4:5 cover: the first photo, or the poster's avatar on the soft aurora gradient (never a grey box). */
export const CoverBox: FC<{ coverUrl: string | null; user: UserSummary; alt: string; className?: string; overlay?: ReactNode }> = ({ coverUrl, user, alt, className, overlay }) => {
  if (coverUrl) return <MediaBox src={coverUrl} alt={alt} aspect="4:5" rounded="none" className={className} overlay={overlay} />;
  return (
    <div className={cn('relative aspect-[4/5] w-full overflow-hidden bg-hero-soft', className)} role="img" aria-label={alt}>
      <div className="absolute inset-0 flex items-center justify-center">
        <UserAvatar user={user} size="2xl" link={false} />
      </div>
      {overlay}
    </div>
  );
};

/* ------------------------------------------------------------------ messaging with context */

/** "Hey {firstName} — looks like we're both {sharedTag} looking near {area} for {month}." */
export function openerFor(card: Pick<RoommateCard, 'firstName' | 'neighborhoods' | 'moveIn' | 'compat'>): string {
  const shared = card.compat?.both[0] ?? null;
  const area = card.neighborhoods[0] ?? null;
  const month = moveInMonthName(card.moveIn);
  const where = area ? ` near ${area}` : '';
  const when = month ? ` for ${month}` : '';
  if (shared) return `Hey ${card.firstName} — looks like we're both ${shared} looking${where}${when}.`;
  return `Hey ${card.firstName} — I saw your roommate post${where}${when}. Want to compare notes?`;
}

const SAFETY_ACK_KEY = 'uv:roommates:safety-ack';

function hasSeenSafety(): boolean {
  try {
    return localStorage.getItem(SAFETY_ACK_KEY) === '1';
  } catch {
    return true;
  }
}

function markSafetySeen(): void {
  try {
    localStorage.setItem(SAFETY_ACK_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Message with the roommate context card + trait-based opener. The first contact ever shows the safety card in a sheet
 * (safety §7.5 "at first contact"); later contacts go straight to the chat.
 */
export function useMessageRoommate(): { start(card: RoommateCard | Pick<RoommateCard, 'id' | 'user' | 'firstName' | 'neighborhoods' | 'moveIn' | 'compat'>): void; sheet: ReactNode } {
  const [pending, setPending] = useState<{ userId: Id; profileId: Id; draft: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (p: { userId: Id; profileId: Id; draft: string }): Promise<void> => {
    setBusy(true);
    try {
      await openDm({ userId: p.userId, context: { kind: 'roommate', id: p.profileId }, draft: p.draft });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const start = (card: Pick<RoommateCard, 'id' | 'user' | 'firstName' | 'neighborhoods' | 'moveIn' | 'compat'>): void => {
    track('roommate_message', { profileId: card.id });
    const p = { userId: card.user.id, profileId: card.id, draft: openerFor(card) };
    if (hasSeenSafety()) {
      void go(p);
      return;
    }
    setPending(p);
  };

  const sheet = (
    <Sheet
      open={pending !== null}
      onOpenChange={(o) => {
        if (!o && !busy) setPending(null);
      }}
      title={ROOMMATE_SAFETY.title}
      description="A few things to keep in mind before you start talking."
      footer={
        <Button
          fullWidth
          loading={busy}
          onClick={() => {
            if (!pending) return;
            markSafetySeen();
            void go(pending);
          }}
        >
          Got it, open the chat
        </Button>
      }
    >
      <ul className="flex flex-col gap-2.5 px-4 pb-4">
        {ROOMMATE_SAFETY.points.map((p) => (
          <li key={p} className="flex gap-2.5 type-body text-ink-2">
            <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </Sheet>
  );

  return { start, sheet };
}

/* ------------------------------------------------------------------ card */

export interface RoommateCardViewProps {
  card: RoommateCard;
  onToggleSave(card: RoommateCard): void;
  onMessage(card: RoommateCard): void;
  /** Called after a successful report so the list can drop the item. */
  onReported?(id: Id): void;
}

export const RoommateCardView: FC<RoommateCardViewProps> = ({ card, onToggleSave, onMessage, onReported }) => {
  const navigate = useNavigate();
  const me = useMe();
  const [menu, setMenu] = useState(false);
  const meta = [card.classLabel, card.major].filter(Boolean).join(' · ');
  const href = routes.roommate(card.id);

  return (
    <Card variant="media" className="relative">
      <button type="button" className="press block w-full text-left" onClick={() => navigate(href)} aria-label={`${card.firstName}, ${card.compat ? `${card.compat.pct}% match` : 'match unknown'}, ${ROOMMATE_MODE_LABEL[card.mode]}`}>
        <CoverBox
          coverUrl={card.coverUrl}
          user={card.user}
          alt={`${card.firstName}'s roommate post`}
          overlay={
            <>
              <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3.5">
                <div className="flex min-w-0 flex-col text-white">
                  <span className="type-overline text-white/80">{card.archetype}</span>
                  <span className="truncate type-title-3">{card.firstName}</span>
                  {meta ? <span className="truncate type-footnote text-white/85">{meta}</span> : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <ModeBadge mode={card.mode} />
                </div>
              </div>
              <div className="absolute top-3 right-3 rounded-full bg-glass p-1 backdrop-blur-md">
                <CompatRing compat={card.compat} size={64} />
              </div>
              {card.isNewAccount ? (
                <div className="absolute top-3 left-3">
                  <Badge variant="outline" tone="neutral" className="bg-glass backdrop-blur-md">
                    New account
                  </Badge>
                </div>
              ) : null}
            </>
          }
        />
      </button>

      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display type-title-3 tabular-nums">
            {formatPrice(card.budget, me.currency)}
            <span className="type-footnote text-ink-3">/mo</span>
          </span>
          <span className="truncate type-footnote text-ink-2">Move-in {formatMoveIn(card.moveIn)}</span>
        </div>
        {card.neighborhoods.length ? <span className="truncate type-footnote text-ink-3">{card.neighborhoods.join(' · ')}</span> : null}
        <div className="scroll-x -mx-1 flex gap-1.5 px-1">
          {card.tags.map((t) => (
            <Chip key={t} variant="tag" size="sm">
              {t}
            </Chip>
          ))}
          {card.lowPriceFlag ? (
            <Badge variant="soft" tone="warning" className="shrink-0">
              Price is unusually low
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="md" leftIcon={MessageCircle} onClick={() => onMessage(card)} className="flex-1">
            Message
          </Button>
          <IconButton
            icon={Bookmark}
            aria-label={card.saved ? 'Remove from saved' : 'Save'}
            variant="filled"
            active={card.saved}
            activeTone="accent"
            aria-pressed={card.saved}
            onClick={() => onToggleSave(card)}
          />
          <IconButton icon={Ellipsis} aria-label="More options" variant="filled" onClick={() => setMenu(true)} />
        </div>
      </div>

      <OverflowMenu
        open={menu}
        onOpenChange={setMenu}
        share={{ card: { kind: 'roommate', id: card.id }, url: absoluteUrl(href), title: `${card.firstName} · ${ROOMMATE_MODE_LABEL[card.mode]}` }}
        report={{ entityType: 'roommate_listing', entityId: card.id, author: card.user, onReported: () => onReported?.(card.id) }}
        blockUser={card.user}
      />
    </Card>
  );
};

export const RoommateCardSkeleton: FC = () => (
  <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
    <Skeleton w="100%" h="auto" className="aspect-[4/5] rounded-none" />
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <Skeleton w={96} h={20} />
        <Skeleton w={110} h={12} />
      </div>
      <Skeleton w="55%" h={12} />
      <div className="flex gap-1.5">
        <Skeleton w={72} h={26} className="rounded-full" />
        <Skeleton w={64} h={26} className="rounded-full" />
        <Skeleton w={88} h={26} className="rounded-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton w="100%" h={44} className="rounded-lg" />
        <Skeleton w={44} h={44} className="rounded-lg" />
        <Skeleton w={44} h={44} className="rounded-lg" />
      </div>
    </div>
  </div>
);

/* ------------------------------------------------------------------ match banner */

/** "Answer 8 quick questions to see your match %." — shown while the viewer has no answers. */
export const MatchBanner: FC<{ className?: string }> = ({ className }) => {
  const navigate = useNavigate();
  return (
    <Card variant="hero" className={cn('flex items-center gap-3', className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Sparkles size={18} strokeWidth={1.75} aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-label">Answer 8 quick questions to see your match %.</span>
        <span className="type-caption text-ink-3">About 2 minutes. Only you can see your answers.</span>
      </div>
      <Button size="sm" variant="secondary" onClick={() => navigate(`${routes.roommatesMeEdit()}?intent=match`)}>
        Start
      </Button>
    </Card>
  );
};

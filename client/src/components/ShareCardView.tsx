import { forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { BedDouble, BookOpen, CalendarDays, Clapperboard, MessageSquareText, Store, User, VenetianMask, type LucideIcon } from 'lucide-react';
import type { ShareCard, ShareCardKind, ShareCardStatus } from '@shared/core';
import { Badge, Surface } from '@/ui';
import { cn } from '@/lib/cn';
import { formatPrice } from '@/lib/format';
import { MediaBox } from './MediaBox';

export interface ShareCardViewProps {
  card: ShareCard;
  /** `bubble` (in a message) · `pinned` (chat context bar) · `compact` (inline link card / share sheet). */
  variant?: 'bubble' | 'pinned' | 'compact';
  /** Default: navigate to `card.href`. */
  onClick?(): void;
  className?: string;
}

const KIND_ICON: Record<ShareCardKind, LucideIcon> = {
  listing: Store,
  roommate: BedDouble,
  reel: Clapperboard,
  post: MessageSquareText,
  event: CalendarDays,
  buzz: VenetianMask,
  profile: User,
  course: BookOpen,
};

const STATUS_CHIP: Partial<Record<ShareCardStatus, { label: string; tone: 'neutral' | 'warning' | 'danger' | 'success' }>> = {
  sold: { label: 'Sold', tone: 'neutral' },
  returned: { label: 'Returned', tone: 'neutral' },
  paused: { label: 'Paused', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
  ended: { label: 'Ended', tone: 'neutral' },
  unavailable: { label: 'No longer available', tone: 'neutral' },
};

/** Live card for anything shareable. kind `'buzz'` renders inside a nested incognito chip-frame — never an avatar. */
export const ShareCardView = forwardRef<HTMLDivElement, ShareCardViewProps>(function ShareCardView(
  { card, variant = 'bubble', onClick, className },
  ref,
) {
  const navigate = useNavigate();
  const Icon = KIND_ICON[card.kind] ?? Store;
  const status = STATUS_CHIP[card.status];
  const gone = card.status === 'unavailable';
  const open = () => {
    if (gone) return;
    if (onClick) onClick();
    else navigate(card.href);
  };
  const compact = variant !== 'bubble';
  const priceLine = card.price !== null ? formatPrice(card.price, card.currency) : null;

  const body = (
    <button
      type="button"
      onClick={open}
      disabled={gone}
      aria-label={`${card.title}${card.subtitle ? `, ${card.subtitle}` : ''}`}
      className={cn(
        'press flex w-full items-center gap-3 text-left',
        compact ? 'min-h-14 px-2.5 py-2' : 'flex-col items-stretch gap-0',
        gone && 'opacity-70',
      )}
    >
      {card.kind === 'buzz' ? (
        <span className={cn('flex shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-ink', compact ? 'size-11' : 'm-3 size-11')}>
          <VenetianMask size={20} strokeWidth={1.75} aria-hidden />
        </span>
      ) : card.imageUrl ? (
        <MediaBox
          src={card.imageUrl}
          alt=""
          aspect={compact ? '1:1' : '16:9'}
          rounded={compact ? 'sm' : 'none'}
          className={compact ? 'w-11 shrink-0' : 'w-full'}
        />
      ) : (
        <span className={cn('flex shrink-0 items-center justify-center rounded-sm bg-surface-3 text-ink-3', compact ? 'size-11' : 'm-3 size-11')}>
          <Icon size={20} strokeWidth={1.75} aria-hidden />
        </span>
      )}
      <span className={cn('flex min-w-0 flex-1 flex-col', !compact && 'gap-0.5 px-3.5 pt-2.5 pb-3')}>
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-ink', compact ? 'type-label-sm' : 'type-headline')}>{card.title}</span>
          {status ? (
            <Badge variant="soft" tone={status.tone}>
              {status.label}
            </Badge>
          ) : card.badge ? (
            <Badge variant="soft" tone={card.badge.toUpperCase() === 'FREE' ? 'gold' : 'accent'}>
              {card.badge}
            </Badge>
          ) : null}
        </span>
        <span className="truncate type-footnote text-ink-3">
          {[priceLine, card.subtitle].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );

  const frame = cn(
    'w-full overflow-hidden rounded-lg border border-line bg-surface-1',
    variant === 'pinned' && 'rounded-md border-accent-line',
    className,
  );

  if (card.kind === 'buzz') {
    return (
      <Surface ref={ref} mode="incognito" className={cn(frame, 'border-accent-line')} data-share-kind="buzz">
        {body}
      </Surface>
    );
  }
  return (
    <div ref={ref} className={frame} data-share-kind={card.kind}>
      {body}
    </div>
  );
});

/**
 * ListingTile (design §7.6 "ListingCard"): 1:1 MediaBox, price / type badge, one-line title, meetup · time, save heart
 * top-right (glass, love tone), Sold = dimmed + "Sold" badge. Fixed geometry so the grid never shifts on load.
 */
import { memo, type FC } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import type { ListingCard as ListingCardType } from '@shared/market';
import { Badge, IconButton, Skeleton } from '@/ui';
import { MediaBox, TimeAgo } from '@/components';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { formatPrice } from '@/lib/format';
import { useSaveMutation } from './api';
import { stateLabel, typeBadge } from './labels';

export interface ListingTileProps {
  card: ListingCardType;
  className?: string;
}

export const ListingTile: FC<ListingTileProps> = memo(function ListingTile({ card, className }) {
  const isOwn = card.isOwn;
  const save = useSaveMutation();
  const closed = stateLabel(card.state);
  const badge = typeBadge(card);
  const href = routes.listing(card.id);

  return (
    <article className={cn('relative flex min-w-0 flex-col gap-2', className)} data-listing-id={card.id}>
      <Link to={href} aria-label={card.title} draggable={false} className="press block rounded-lg focus-visible:focus-ring">
        <MediaBox
          src={card.coverUrl}
          alt={card.title}
          aspect="1:1"
          rounded="lg"
          className={cn(closed && 'opacity-50')}
          overlay={
            <>
              {closed ? (
                <span className="absolute left-2 top-2">
                  <Badge variant="soft" tone="neutral">{closed}</Badge>
                </span>
              ) : card.lowPriceFlag ? (
                <span className="absolute left-2 top-2">
                  <Badge variant="soft" tone="warning">Low price</Badge>
                </span>
              ) : null}
              {card.courseCode ? (
                <span className="absolute bottom-2 left-2">
                  <Badge variant="soft" tone="accent">{card.courseCode}</Badge>
                </span>
              ) : null}
            </>
          }
        />
      </Link>
      {!isOwn ? (
        <IconButton
          icon={Heart}
          aria-label={card.saved ? 'Unsave' : 'Save'}
          variant="glass"
          size="sm"
          active={card.saved}
          activeTone="love"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: card.id, saved: !card.saved })}
          className="absolute right-1.5 top-1.5"
        />
      ) : null}
      <Link to={href} draggable={false} className="flex min-w-0 flex-col gap-0.5 rounded-sm focus-visible:focus-ring">
        <div className="flex min-h-6 items-center gap-1.5">
          {card.type === 'sell' ? (
            <span className="truncate type-headline font-display tabular-nums text-ink">{formatPrice(card.price)}</span>
          ) : badge ? (
            <>
              <Badge variant={badge.variant} tone={badge.tone}>{badge.label}</Badge>
              {card.type === 'trade' && card.price !== null ? (
                <span className="truncate type-caption tabular-nums text-ink-2">or {formatPrice(card.price)}</span>
              ) : null}
            </>
          ) : null}
        </div>
        <span className="truncate type-footnote text-ink">{card.title}</span>
        {card.type === 'trade' && card.tradeFor ? <span className="truncate type-caption text-ink-2">for {card.tradeFor}</span> : null}
        <span className="truncate type-caption text-ink-3">
          {card.meetupSpot ? <>{card.meetupSpot} · </> : null}
          <TimeAgo ts={card.createdAt} />
        </span>
      </Link>
    </article>
  );
});

/** Same geometry as the tile: square + three lines. */
export const ListingTileSkeleton: FC<{ className?: string }> = ({ className }) => (
  <div className={cn('flex flex-col gap-2', className)} aria-hidden>
    <Skeleton h="auto" className="aspect-square w-full rounded-lg" />
    <Skeleton w="45%" h={18} />
    <Skeleton w="85%" h={13} />
    <Skeleton w="60%" h={11} />
  </div>
);

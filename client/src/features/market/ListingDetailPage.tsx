/**
 * `/market/:id` (design §7.6 "Listing detail"): swipeable 4:3 gallery + Lightbox, price / title / tag chips,
 * description, meetup spot, seller card with trust chips, SafetyCard, low-price warning, and the bottom CTA bar.
 * Request-aware buttons (SPEC §5.8): "Request sent — waiting for {first}", Message seller ↔ Open chat, Make offer ↔
 * "Offer sent", Propose a trade on trade listings. Owner: stats, Edit / Mark sold|returned / Relist / Delete.
 */
import { useRef, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowLeftRight, CalendarDays, Clock, Ellipsis, Eye, HandCoins, Heart, MapPin, MessageCircle, PackageX, Pencil, RotateCcw, Share, ShieldAlert, Trash2,
} from 'lucide-react';
import type { Id, MediaImage } from '@shared/core';
import type { Listing } from '@shared/market';
import { LISTING_CONDITION_LABELS, LOW_PRICE_COPY, MARKET_SAFETY_POINTS, MARKET_SAFETY_TITLE } from '@shared/market';
import { Badge, Button, Chip, Dialog, EmptyState, ErrorState, IconButton, Lightbox, ListRow, PageHeader, Screen, Skeleton, SkeletonText } from '@/ui';
import { MediaBox, OverflowMenu, SafetyCard, TimeAgo, UserRow } from '@/components';
import { cn } from '@/lib/cn';
import { errorMessage, isApiError } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { openDm } from '@/lib/dm';
import { firstName, formatCount, formatPrice } from '@/lib/format';
import { useLocalStorage } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { deleteListingRequest, dropListing, invalidateMarketLists, markClosedRequest, relistRequest, seedListingDetail, useListing, useSaveMutation } from './api';
import { categoryLabel, closeState, memberSince, occurredOnLabel, priceLine, stateLabel, typeBadge } from './labels';
import { OfferSheet, trackOfferOpen } from './OfferSheet';

export const ListingDetailPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  return <ListingDetail key={id} id={id} />;
};

const ListingDetail: FC<{ id: Id }> = ({ id }) => {
  const navigate = useNavigate();
  const q = useListing(id);
  useScreenView('listing_detail');
  const gone = q.isError && isApiError(q.error) && q.error.status === 404;

  return (
    <Screen
      header={<PageHeader title="Listing" mode="compact" back actions={q.data ? <DetailActions listing={q.data} /> : undefined} />}
      footer={q.data ? <DetailFooter listing={q.data} /> : undefined}
    >
      {q.isLoading ? (
        <DetailSkeleton />
      ) : gone ? (
        <EmptyState icon={PackageX} title="This listing is no longer available." action={{ label: 'Back to Marketplace', onClick: () => navigate(routes.market()) }} />
      ) : q.isError || !q.data ? (
        <ErrorState title="Couldn't load this listing" error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <DetailBody listing={q.data} />
      )}
    </Screen>
  );
};

/* ───────────────────────────── header actions (share + overflow) ───────────────────────────── */

const DetailActions: FC<{ listing: Listing }> = ({ listing }) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSelf = listing.viewer.isSelf;
  const share = { card: { kind: 'listing' as const, id: listing.id }, url: routes.listing(listing.id), title: listing.title, text: priceLine(listing) };

  const del = useMutation({
    mutationFn: () => deleteListingRequest(listing.id),
    onSuccess: () => {
      dropListing(listing.id);
      invalidateMarketLists();
      toast.success('Listing deleted');
      navigate(routes.marketMine(), { replace: true });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <>
      <IconButton icon={Share} aria-label="Share listing" onClick={() => openShare(share)} />
      <IconButton icon={Ellipsis} aria-label="More" onClick={() => setMenuOpen(true)} />
      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={isSelf ? [{ icon: Pencil, label: 'Edit listing', onSelect: () => navigate(routes.listingEdit(listing.id)) }] : undefined}
        share={share}
        report={
          isSelf
            ? undefined
            : {
                entityType: 'market_listing',
                entityId: listing.id,
                author: listing.seller,
                onReported: () => {
                  dropListing(listing.id);
                  navigate(routes.market(), { replace: true });
                },
              }
        }
        blockUser={isSelf ? null : listing.seller}
        onDelete={isSelf ? () => setConfirmDelete(true) : undefined}
        deleteLabel="Delete listing"
      />
      <Dialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this listing?"
        description="It disappears from the Marketplace and from every chat where it was pinned. This can't be undone."
        icon={Trash2}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={() => del.mutateAsync()}
      />
    </>
  );
};

/* ───────────────────────────── body ───────────────────────────── */

const DetailBody: FC<{ listing: Listing }> = ({ listing: l }) => {
  const navigate = useNavigate();
  const save = useSaveMutation();
  const closed = stateLabel(l.state);
  const badge = typeBadge(l);
  const trust = l.sellerTrust;
  const lostFound = l.type === 'lost' || l.type === 'found';

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Gallery photos={l.photos} title={l.title} dimmed={Boolean(closed)} />

      <section className="flex flex-col gap-2 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              {l.type === 'sell' ? (
                <span className="type-title-1 font-display tabular-nums text-ink">{formatPrice(l.price)}</span>
              ) : badge ? (
                <Badge variant={badge.variant} tone={badge.tone}>{badge.label}</Badge>
              ) : null}
              {closed ? <Badge variant="soft" tone="neutral">{closed}</Badge> : null}
              {l.viewer.isSelf ? <ContentStatusChip status={l.status} /> : null}
            </div>
            {l.type === 'trade' ? (
              <span className="type-headline text-ink">
                Trade · for {l.tradeFor}
                {l.price !== null ? <span className="text-ink-2"> or {formatPrice(l.price)}</span> : null}
              </span>
            ) : null}
            <h1 className="type-title-3 text-ink">{l.title}</h1>
            <span className="type-caption text-ink-3">
              Posted <TimeAgo ts={l.createdAt} />
              {l.expiresAt > Date.now() && l.state === 'active' ? <> · expires in {Math.max(1, Math.ceil((l.expiresAt - Date.now()) / 86_400_000))} d</> : null}
            </span>
          </div>
          {!l.viewer.isSelf ? (
            <IconButton
              icon={Heart}
              aria-label={l.saved ? 'Unsave' : 'Save'}
              variant="filled"
              active={l.saved}
              activeTone="love"
              disabled={save.isPending}
              onClick={() => {
                track('listing_save', { saved: !l.saved });
                save.mutate({ id: l.id, saved: !l.saved });
              }}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {l.condition ? <Chip variant="tag" size="sm">{LISTING_CONDITION_LABELS[l.condition]}</Chip> : null}
          <Chip variant="tag" size="sm">{categoryLabel(l.category)}</Chip>
          {l.courseCode ? (
            <Chip variant="filter" size="sm" onClick={() => navigate(routes.market({ course: l.courseCode ?? undefined }))}>
              Textbooks for {l.courseCode}
            </Chip>
          ) : null}
        </div>
      </section>

      {l.lowPriceFlag ? (
        <div role="note" className="mx-4 flex items-center gap-2.5 rounded-lg border border-warning/45 bg-warning-soft px-3.5 py-2.5">
          <ShieldAlert size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-warning" />
          <span className="type-footnote text-ink">{LOW_PRICE_COPY}</span>
        </div>
      ) : null}

      {l.viewer.isSelf && l.stats ? (
        <section aria-label="Listing stats" className="mx-4 grid grid-cols-3 gap-2 rounded-lg border border-line bg-surface-1 p-3">
          <Stat icon={Eye} value={l.stats.views} label="views" />
          <Stat icon={Heart} value={l.stats.saves} label="saves" />
          <Stat icon={MessageCircle} value={l.stats.chats} label="chats" />
        </section>
      ) : null}

      {l.description ? <p className="whitespace-pre-wrap px-4 type-body text-ink-2">{l.description}</p> : null}

      <div className="flex flex-col">
        {lostFound && l.locationText ? (
          <ListRow leading={<IconDisc icon={MapPin} />} title={l.type === 'lost' ? 'Last seen' : 'Found at'} subtitle={l.locationText} />
        ) : null}
        {lostFound && l.occurredOn ? <ListRow leading={<IconDisc icon={CalendarDays} />} title="When" subtitle={occurredOnLabel(l.occurredOn)} /> : null}
        {!lostFound && l.meetupSpot ? <ListRow leading={<IconDisc icon={MapPin} />} title="Meetup spot" subtitle={l.meetupSpot} /> : null}
      </div>

      <section aria-label="Seller" className="mx-4 rounded-lg border border-line bg-surface-1 pb-3">
        <UserRow user={l.seller} trailing="none" subtitle={`@${l.seller.handle} · ${l.seller.universityShortName}`} />
        <div className="flex flex-wrap gap-1.5 px-4">
          {trust.isNewAccount ? <Badge variant="soft" tone="warning">New account</Badge> : null}
          {trust.classLabel ? <Badge variant="soft" tone="neutral">{trust.classLabel}</Badge> : null}
          <Badge variant="soft" tone="neutral">Since {memberSince(trust.memberSince)}</Badge>
          <Badge variant="soft" tone="neutral">{trust.activeListings} active</Badge>
          <Badge variant="soft" tone={trust.completedListings > 0 ? 'success' : 'neutral'}>{trust.completedListings} sold</Badge>
        </div>
      </section>

      <SafetyCard title={MARKET_SAFETY_TITLE} points={MARKET_SAFETY_POINTS} storageKey="uv:market:safety" tone="warning" />
    </div>
  );
};

const Stat: FC<{ icon: typeof Eye; value: number; label: string }> = ({ icon: Icon, value, label }) => (
  <div className="flex flex-col items-center gap-0.5">
    <Icon size={16} strokeWidth={1.75} aria-hidden className="text-ink-3" />
    <span className="type-headline tabular-nums text-ink">{formatCount(value)}</span>
    <span className="type-caption text-ink-3">{label}</span>
  </div>
);

const IconDisc: FC<{ icon: typeof MapPin }> = ({ icon: Icon }) => (
  <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
    <Icon size={18} strokeWidth={1.75} aria-hidden />
  </span>
);

/* ───────────────────────────── gallery ───────────────────────────── */

const Gallery: FC<{ photos: MediaImage[]; title: string; dimmed: boolean }> = ({ photos, title, dimmed }) => {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  if (photos.length === 0) {
    return <MediaBox src={null} alt={title} aspect="4:3" rounded="none" className={cn(dimmed && 'opacity-60')} />;
  }
  const onScroll = () => {
    const el = scroller.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(Math.min(photos.length - 1, Math.max(0, i)));
  };
  return (
    <div className="relative">
      <div ref={scroller} onScroll={onScroll} className="scroll-x flex snap-x snap-mandatory" aria-roledescription="carousel" aria-label={`${title} photos`}>
        {photos.map((p, i) => (
          <div key={`${p.url}-${i}`} className="w-full shrink-0 snap-center snap-always">
            <MediaBox src={p.url} alt={p.alt ?? `${title}, photo ${i + 1} of ${photos.length}`} aspect="4:3" rounded="none" onClick={() => { setIndex(i); setOpen(true); }} className={cn(dimmed && 'opacity-60')} />
          </div>
        ))}
      </div>
      {photos.length > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center gap-1.5" aria-hidden>
          {photos.map((_, i) => (
            <span key={i} className={cn('size-1.5 rounded-full transition-colors', i === index ? 'bg-white' : 'bg-white/40')} />
          ))}
        </div>
      ) : null}
      <Lightbox open={open} onOpenChange={setOpen} images={photos} index={index} onIndexChange={setIndex} />
    </div>
  );
};

/* ───────────────────────────── footer CTA bar ───────────────────────────── */

const DetailFooter: FC<{ listing: Listing }> = ({ listing: l }) => {
  const navigate = useNavigate();
  const [offerOpen, setOfferOpen] = useState(false);
  const [interstitial, setInterstitial] = useState(false);
  /** Draft deferred by the first-contact interstitial ("Propose a trade" prefill), replayed on "Got it". */
  const [pendingDraft, setPendingDraft] = useState<string | undefined>(undefined);
  const [confirmClose, setConfirmClose] = useState(false);
  const [firstContactSeen, setFirstContactSeen] = useLocalStorage<boolean>('uv:market:firstcontact', false);
  const live = l.state === 'active' && l.status === 'active';

  const close = useMutation({
    mutationFn: () => markClosedRequest(l.id, closeState(l.type)),
    onSuccess: (res) => {
      seedListingDetail(res);
      invalidateMarketLists();
      toast.success(closeState(l.type) === 'sold' ? 'Marked as sold' : 'Marked as returned');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const relist = useMutation({
    mutationFn: () => relistRequest(l.id),
    onSuccess: (res) => {
      seedListingDetail(res);
      invalidateMarketLists();
      toast.success('Back on the Marketplace for 30 days');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (l.viewer.isSelf) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <Button variant="secondary" leftIcon={Pencil} onClick={() => navigate(routes.listingEdit(l.id))} className="flex-1">
          Edit
        </Button>
        {l.state === 'active' ? (
          <Button variant="primary" onClick={() => setConfirmClose(true)} loading={close.isPending} className="flex-1">
            {closeState(l.type) === 'sold' ? 'Mark sold' : 'Mark returned'}
          </Button>
        ) : (
          <Button variant="primary" leftIcon={RotateCcw} onClick={() => relist.mutate()} loading={relist.isPending} className="flex-1">
            Relist
          </Button>
        )}
        <Dialog
          open={confirmClose}
          onOpenChange={setConfirmClose}
          title={closeState(l.type) === 'sold' ? 'Mark as sold?' : 'Mark as returned?'}
          description="It stays visible with a ribbon for 7 days and every open chat about it updates live."
          confirmLabel={closeState(l.type) === 'sold' ? 'Mark sold' : 'Mark returned'}
          onConfirm={async () => {
            await close.mutateAsync();
          }}
        />
      </div>
    );
  }

  /** Tracked only when a chat actually opens, never for an interstitial that is shown and dismissed. */
  const openListingDm = (draft?: string) => {
    track('listing_message', { type: l.type });
    void openDm({ userId: l.seller.id, context: { kind: 'listing', id: l.id }, draft });
  };
  const startDm = (draft?: string) => {
    if (l.viewer.hasConversation && l.viewer.conversationId) {
      track('listing_message', { type: l.type });
      navigate(routes.chat(l.viewer.conversationId), draft ? { state: { draft } } : undefined);
      return;
    }
    if (!firstContactSeen) {
      setPendingDraft(draft);
      setInterstitial(true);
      return;
    }
    openListingDm(draft);
  };
  const proposeTrade = () => startDm(`I could trade … for your ${l.title}`);

  if (!live) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1 type-footnote text-ink-2">
          {l.state === 'sold' ? 'This item was sold.' : l.state === 'returned' ? 'This item was returned to its owner.' : l.state === 'expired' ? 'This listing has expired.' : 'This listing is not available right now.'}
        </span>
        {l.viewer.hasConversation && l.viewer.conversationId ? (
          <Button variant="secondary" leftIcon={MessageCircle} onClick={() => navigate(routes.chat(l.viewer.conversationId!))}>
            Open chat
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {l.viewer.requestPending ? (
        <div role="status" className="flex items-center gap-2 type-caption text-ink-2">
          <Clock size={14} strokeWidth={1.75} aria-hidden className="text-ink-3" />
          Request sent — waiting for {firstName(l.seller.displayName)}
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" leftIcon={MessageCircle} onClick={() => startDm()} className="flex-1">
          {l.viewer.hasConversation ? 'Open chat' : 'Message seller'}
        </Button>
        {l.type === 'sell' ? (
          <Button
            variant="secondary"
            leftIcon={HandCoins}
            disabled={l.viewer.hasPendingOffer}
            onClick={() => {
              trackOfferOpen(l.id);
              setOfferOpen(true);
            }}
            className="flex-1"
          >
            {l.viewer.hasPendingOffer ? 'Offer sent' : 'Make offer'}
          </Button>
        ) : l.type === 'trade' ? (
          <Button variant="secondary" leftIcon={ArrowLeftRight} onClick={proposeTrade} className="flex-1">
            Propose a trade
          </Button>
        ) : null}
      </div>
      {l.type === 'sell' ? <OfferSheet open={offerOpen} onOpenChange={setOfferOpen} listing={l} /> : null}
      <Dialog
        open={interstitial}
        onOpenChange={setInterstitial}
        title="Before you message"
        icon={ShieldAlert}
        description={
          <ul className="flex flex-col gap-1.5 text-left">
            {MARKET_SAFETY_POINTS.map((p) => (
              <li key={p} className="type-footnote text-ink-2">
                {p}
              </li>
            ))}
          </ul>
        }
        confirmLabel="Got it"
        onConfirm={() => {
          setFirstContactSeen(true);
          openListingDm(pendingDraft);
          setPendingDraft(undefined);
        }}
      />
    </div>
  );
};

/* ───────────────────────────── skeleton ───────────────────────────── */

const DetailSkeleton: FC = () => (
  <div className="flex flex-col gap-4 pb-4" aria-busy="true" aria-label="Loading listing">
    <Skeleton h="auto" className="aspect-[4/3] w-full rounded-none" />
    <div className="flex flex-col gap-2 px-4">
      <Skeleton w="30%" h={28} />
      <Skeleton w="70%" h={20} />
      <Skeleton w="40%" h={12} />
    </div>
    <div className="px-4">
      <SkeletonText lines={3} />
    </div>
    <div className="mx-4 flex items-center gap-3 rounded-lg border border-line p-3">
      <Skeleton circle w={40} h={40} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton w="45%" h={14} />
        <Skeleton w="30%" h={10} />
      </div>
    </div>
  </div>
);

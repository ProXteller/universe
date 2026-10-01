/**
 * Message bubbles (design §7.4): mine `bg-accent text-on-accent`, theirs `bg-surface-2`, radius 20 with a 6px tail
 * corner, images ≤ 240px, offer bubbles, cards, system lines, deleted / withheld / collapsed-by-block states,
 * reactions (double-tap = ❤️), recipient safety banners, reply quotes.
 */
import { useState, type FC, type ReactNode } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, Clock, CornerUpLeft, Copy, Ellipsis, ImageOff, Tag } from 'lucide-react';
import type { Id, MessageReactionEmoji, ShareCard, UserSummary } from '@shared/core';
import { MESSAGE_REACTIONS } from '@shared/core';
import { Badge, Button, IconButton, Skeleton } from '@/ui';
import { OverflowMenu, ShareCardView, UserAvatar } from '@/components';
import { cn } from '@/lib/cn';
import { firstName, formatPrice } from '@/lib/format';
import { useDoubleTap } from '@/lib/hooks';
import { openBlock, openReport } from '@/lib/report';
import { absoluteUrl } from '@/lib/share';
import { toast } from '@/lib/toast';
import type { LocalMessage } from './api';
import { RecipientBannerView } from './parts';

export interface BubbleActions {
  onReact(message: LocalMessage, emoji: MessageReactionEmoji | null): void;
  onReply(message: LocalMessage): void;
  onDelete(message: LocalMessage): void;
  onRetry(message: LocalMessage): void;
  onOffer(message: LocalMessage, action: 'accept' | 'decline' | 'withdraw'): void;
  onOpenImage(message: LocalMessage, index: number): void;
  onBlockAndReport(message: LocalMessage): void;
}

export interface BubbleProps {
  m: LocalMessage;
  mine: boolean;
  /** First / last in a same-sender run (tail corner, avatar, spacing). */
  first: boolean;
  last: boolean;
  /** Group chats: show the sender's name on the first bubble of a run. */
  showSender: boolean;
  /** Quoted message when `replyToId` is loaded. */
  replyTo: LocalMessage | null;
  /** Viewer is the listing owner of this offer (Accept / Decline). */
  offerOwner: boolean;
  /** The pinned / resolved listing card for offers (price context). */
  offerCard: ShareCard | null;
  selected: boolean;
  onSelect(id: Id | null): void;
  /**
   * Viewer's membership is 'active' (not an unaccepted request). React / reply are server-gated on that
   * (`setReaction` → members['active']), so a request screen hides them (R7); Copy / Report / Block stay reachable.
   */
  interactive?: boolean;
  /** Read-receipt line under the last own bubble ("Seen 3:45 PM" / avatar stack). */
  receipt?: ReactNode;
  actions: BubbleActions;
}

const timeOf = (ts: number) => format(new Date(ts), 'h:mm a');

/* ───────────────────────────── reactions ───────────────────────────── */

const ReactionChips: FC<{ m: LocalMessage; mine: boolean; interactive: boolean; onReact: BubbleActions['onReact'] }> = ({ m, mine, interactive, onReact }) => {
  if (m.reactions.length === 0) return null;
  return (
    <div className={cn('-mt-1.5 flex flex-wrap gap-1', mine ? 'justify-end pr-1' : 'pl-1')}>
      {m.reactions.map((r) => {
        const label = `${r.emoji} ${r.count}${r.mine ? ', you reacted' : ''}`;
        const chip = cn(
          'flex h-7 items-center gap-1 rounded-full border px-2 type-caption tabular-nums',
          r.mine ? 'border-accent-line bg-accent-soft text-accent-ink' : 'border-line bg-surface-1 text-ink-2',
        );
        const inner = (
          <>
            <span aria-hidden>{r.emoji}</span>
            {r.count > 1 ? <span>{r.count}</span> : null}
          </>
        );
        // request screen: reactions are read-only until the viewer accepts (toggling them would 404, R7)
        if (!interactive) {
          return (
            <span key={r.emoji} role="img" aria-label={label} className={chip}>
              {inner}
            </span>
          );
        }
        return (
          <button key={r.emoji} type="button" aria-pressed={r.mine} aria-label={label} onClick={() => onReact(m, r.mine ? null : r.emoji)} className={cn('press', chip)}>
            {inner}
          </button>
        );
      })}
    </div>
  );
};

/** Emoji row + "More"; on a request screen (`interactive` false) only "More" (Copy / Report / Block) is offered. */
const ReactionBar: FC<{ m: LocalMessage; mine: boolean; interactive: boolean; onPick(e: MessageReactionEmoji | null): void; onMore(): void }> = ({ m, mine, interactive, onPick, onMore }) => (
  <div className={cn('mt-1 flex items-center gap-1 rounded-full border border-line bg-surface-1 p-1 shadow-sm', mine ? 'self-end' : 'self-start')} role="group" aria-label={interactive ? 'React' : 'Message actions'}>
    {interactive
      ? MESSAGE_REACTIONS.map((e) => {
          const active = m.reactions.some((r) => r.emoji === e && r.mine);
          return (
            <button
              key={e}
              type="button"
              aria-label={`React ${e}`}
              aria-pressed={active}
              onClick={() => onPick(active ? null : e)}
              className={cn('press flex size-10 items-center justify-center rounded-full text-lg', active && 'bg-accent-soft')}
            >
              {e}
            </button>
          );
        })
      : null}
    <IconButton icon={Ellipsis} aria-label="More" size="sm" onClick={onMore} />
  </div>
);

/* ───────────────────────────── bubble body variants ───────────────────────────── */

const ImagesGrid: FC<{ m: LocalMessage; mine: boolean; onOpen(i: number): void }> = ({ m, mine, onOpen }) => {
  if (m.imagesWithheld) {
    return (
      <div className={cn('flex h-24 w-40 flex-col items-center justify-center gap-1 rounded-lg bg-surface-3 text-ink-3')}>
        <ImageOff size={18} strokeWidth={1.75} aria-hidden />
        <span className="type-caption">Accept to view photos</span>
      </div>
    );
  }
  return (
    <div className={cn('flex flex-wrap gap-0.5', mine ? 'justify-end' : 'justify-start', m.images.length > 1 ? 'max-w-60' : '')}>
      {m.images.map((img, i) => (
        <button
          key={`${img.url}-${i}`}
          type="button"
          onClick={() => onOpen(i)}
          aria-label={img.alt ? `Open photo: ${img.alt}` : `Open photo ${i + 1}`}
          className={cn('press overflow-hidden rounded-lg bg-surface-2', m.images.length > 1 ? 'size-[118px]' : 'max-h-60 max-w-60')}
        >
          <img src={img.url} alt={img.alt ?? ''} loading="lazy" draggable={false} className={cn('block object-cover', m.images.length > 1 ? 'size-full' : 'max-h-60 max-w-60')} />
        </button>
      ))}
    </div>
  );
};

const OfferBody: FC<{ m: LocalMessage; mine: boolean; owner: boolean; card: ShareCard | null; actions: BubbleActions }> = ({ m, mine, owner, card, actions }) => {
  const offer = m.offer!;
  const status = offer.status;
  const tone = status === 'accepted' ? 'success' : status === 'declined' || status === 'withdrawn' ? 'neutral' : 'accent';
  const label = status === 'pending' ? 'Pending' : status === 'accepted' ? 'Accepted' : status === 'declined' ? 'Declined' : 'Withdrawn';
  return (
    <div className="flex min-w-48 flex-col gap-2">
      <div className="flex items-center gap-2">
        <Tag size={16} strokeWidth={1.75} aria-hidden className={mine ? 'text-on-accent/80' : 'text-accent-ink'} />
        <span className="type-label">Offer: {formatPrice(offer.amount, offer.currency)}</span>
        <Badge variant="soft" tone={tone} className={mine ? 'bg-white/15 text-on-accent' : undefined}>
          {label}
        </Badge>
      </div>
      {card ? (
        <span className={cn('truncate type-caption', mine ? 'text-on-accent/80' : 'text-ink-2')}>
          {card.title}
          {card.price !== null ? ` · asking ${formatPrice(card.price, card.currency)}` : ''}
        </span>
      ) : null}
      {status === 'pending' && owner ? (
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={() => actions.onOffer(m, 'accept')}>
            Accept
          </Button>
          <Button size="sm" variant="secondary" onClick={() => actions.onOffer(m, 'decline')}>
            Decline
          </Button>
        </div>
      ) : null}
      {status === 'pending' && mine ? (
        <Button size="sm" variant="ghost" onClick={() => actions.onOffer(m, 'withdraw')} className={mine ? 'self-start text-on-accent' : 'self-start'}>
          Withdraw offer
        </Button>
      ) : null}
    </div>
  );
};

/* ───────────────────────────── the bubble ───────────────────────────── */

export const MessageBubble: FC<BubbleProps> = ({ m, mine, first, last, showSender, replyTo, offerOwner, offerCard, selected, onSelect, receipt, actions, interactive = true }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const sender = m.sender;

  const onTap = useDoubleTap<HTMLDivElement>(
    () => onSelect(selected ? null : m.id),
    () => {
      if (!interactive || m.deleted || m.pending || m.failed) return;
      const has = m.reactions.some((r) => r.emoji === '❤️' && r.mine);
      actions.onReact(m, has ? null : '❤️');
    },
  );

  if (m.kind === 'system') {
    return (
      <div className="flex justify-center px-6 py-1.5">
        <span className="text-center type-caption text-ink-3">{m.text}</span>
      </div>
    );
  }

  if (m.collapsedByBlock && !revealed) {
    return (
      <div className="flex justify-start px-4 py-0.5">
        <button type="button" onClick={() => setRevealed(true)} className="rounded-full border border-line px-3 py-1.5 type-caption text-ink-3">
          Message from a blocked account · Show
        </button>
      </div>
    );
  }

  const canAct = !m.deleted && !m.pending && !m.failed;
  // react / reply need an active membership (server: members['active']); Copy, Report, Block and Delete do not
  const canInteract = interactive && canAct;
  const radius = mine
    ? cn('rounded-[20px]', last && 'rounded-br-[6px]')
    : cn('rounded-[20px]', last && 'rounded-bl-[6px]');
  const shell = m.deleted
    ? 'border border-line bg-transparent text-ink-3 italic'
    : m.kind === 'card'
      ? 'bg-transparent p-0'
      : mine
        ? cn('bg-accent text-on-accent', m.failed && 'opacity-60')
        : 'bg-surface-2 text-ink';

  let body: ReactNode;
  if (m.deleted) body = <span className="type-body">Message deleted</span>;
  else if (m.kind === 'card' && m.card) body = <ShareCardView card={m.card} variant="bubble" />;
  else if (m.kind === 'offer' && m.offer) body = <OfferBody m={m} mine={mine} owner={offerOwner} card={offerCard} actions={actions} />;
  else {
    body = (
      <>
        {m.images.length > 0 || m.imagesWithheld ? <ImagesGrid m={m} mine={mine} onOpen={(i) => actions.onOpenImage(m, i)} /> : null}
        {m.text ? <p className="whitespace-pre-wrap break-words type-body">{m.text}</p> : null}
      </>
    );
  }

  const quote =
    m.replyToId && !m.deleted ? (
      <div className={cn('mb-1 flex items-start gap-1.5 border-l-2 pl-2 type-caption', mine ? 'border-on-accent/60 text-on-accent/80' : 'border-accent text-ink-2')}>
        <CornerUpLeft size={12} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" />
        <span className="line-clamp-2">
          {replyTo ? `${replyTo.sender ? firstName(replyTo.sender.displayName) : 'System'}: ${replyTo.deleted ? 'Message deleted' : replyTo.text || (replyTo.kind === 'image' ? 'Photo' : replyTo.kind === 'offer' ? 'Offer' : 'Shared a link')}` : 'Earlier message'}
        </span>
      </div>
    ) : null;

  const timeRow = (
    <span className={cn('mt-0.5 flex items-center gap-1 type-micro', mine ? 'justify-end text-on-accent/70' : 'text-ink-3')}>
      {timeOf(m.createdAt)}
      {mine && m.pending ? <Clock size={11} strokeWidth={2} aria-label="Sending" /> : null}
      {mine && !m.pending && !m.failed ? <Check size={11} strokeWidth={2.5} aria-hidden /> : null}
    </span>
  );

  const menuItems = [
    ...(canAct && m.text ? [{ icon: Copy, label: 'Copy', onSelect: () => void navigator.clipboard?.writeText(m.text).then(() => toast.success('Copied')) }] : []),
    ...(canInteract ? [{ icon: CornerUpLeft, label: 'Reply', onSelect: () => actions.onReply(m) }] : []),
  ];

  return (
    <div className={cn('flex flex-col px-4', mine ? 'items-end' : 'items-start', first ? 'mt-3' : 'mt-0.5')}>
      {showSender && first && !mine && sender ? (
        <span className="mb-0.5 ml-10 type-caption text-ink-3">{sender.displayName}</span>
      ) : null}
      <div className={cn('flex max-w-[78%] items-end gap-2', mine ? 'flex-row-reverse' : 'flex-row')}>
        {!mine && showSender ? (
          <span className="w-8 shrink-0">{last && sender ? <UserAvatar user={sender} size="sm" /> : null}</span>
        ) : null}
        <div
          role="button"
          tabIndex={0}
          aria-label={`Message from ${sender ? sender.displayName : 'system'} at ${timeOf(m.createdAt)}`}
          aria-expanded={selected}
          onClick={(e) => {
            // nested controls (Accept / Decline, photos, card) handle their own taps
            if ((e.target as HTMLElement).closest('button, a')) return;
            onTap(e);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(selected ? null : m.id);
            }
          }}
          className={cn('flex min-w-0 flex-col outline-none focus-visible:focus-ring', m.kind === 'card' ? '' : cn('px-3.5 py-2', radius, shell))}
        >
          {quote}
          {body}
          {m.kind !== 'card' ? timeRow : null}
        </div>
      </div>
      {m.failed ? (
        <button type="button" onClick={() => actions.onRetry(m)} className="mt-1 type-caption text-danger">
          Not delivered. Tap to retry.
        </button>
      ) : null}
      <ReactionChips m={m} mine={mine} interactive={interactive} onReact={actions.onReact} />
      {selected && canAct ? (
        <ReactionBar
          m={m}
          mine={mine}
          interactive={interactive}
          onPick={(e) => {
            actions.onReact(m, e);
            onSelect(null);
          }}
          onMore={() => setMenuOpen(true)}
        />
      ) : null}
      {!mine && m.banner && !m.deleted ? (
        <RecipientBannerView banner={m.banner} sender={sender} onBlockAndReport={() => actions.onBlockAndReport(m)} className="mt-1.5 max-w-[92%]" />
      ) : null}
      {receipt}
      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        items={menuItems}
        share={m.kind === 'card' && m.card ? { card: { kind: m.card.kind, id: m.card.id }, url: absoluteUrl(m.card.href), title: m.card.title } : undefined}
        report={!mine && sender ? { entityType: 'message', entityId: m.id, author: sender } : undefined}
        blockUser={!mine ? sender : null}
        onDelete={mine && canAct ? () => actions.onDelete(m) : undefined}
        deleteLabel="Delete for everyone"
        title={sender ? `${firstName(sender.displayName)} · ${timeOf(m.createdAt)}` : undefined}
      />
    </div>
  );
};

/* ───────────────────────────── read receipt line ───────────────────────────── */

export const SeenLine: FC<{ at: number | null; users?: UserSummary[] }> = ({ at, users }) => {
  if (users && users.length > 0) {
    return (
      <span className="mt-1 flex items-center gap-1 type-micro text-ink-3">
        <CheckCheck size={14} strokeWidth={2} aria-hidden />
        Seen by
        <span className="flex -space-x-1">
          {users.slice(0, 4).map((u) => (
            <UserAvatar key={u.id} user={u} size="xs" link={false} className="ring-1 ring-canvas" />
          ))}
        </span>
        {users.length > 4 ? `+${users.length - 4}` : null}
      </span>
    );
  }
  return (
    <span className="mt-1 flex items-center gap-1 type-micro text-ink-3">
      <CheckCheck size={14} strokeWidth={2} aria-hidden />
      {at ? `Seen ${timeOf(at)}` : 'Seen'}
    </span>
  );
};

export const BubbleSkeleton: FC<{ mine?: boolean; w?: number }> = ({ mine = false, w = 160 }) => (
  <div className={cn('flex px-4 py-0.5', mine ? 'justify-end' : 'justify-start')}>
    <Skeleton w={w} h={40} className="rounded-[20px]" />
  </div>
);

/** "Block & report" in one tap from a recipient banner (safety §7.3): block first, then the report sheet. */
export function blockAndReport(sender: UserSummary, messageId: Id): void {
  openBlock(sender, { onBlocked: () => openReport({ entityType: 'message', entityId: messageId, author: sender }) });
}

/**
 * BuzzCard — the feed card (design §7.2): `surface-1`, rounded-lg, alias header, text (6-line clamp), poll, footer with the
 * vote cluster, reply count, share and overflow. Community-collapsed cards fold to one line. Own held / hidden / removed
 * cards carry the ContentStatusChip. Never an avatar, never a handle.
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Buzz } from '@shared/buzz';
import { Badge, Skeleton, SkeletonText } from '@/ui';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { removeBuzzItem } from './api';
import { BuzzContent, BuzzMediaView } from './body';
import { AliasLine, CollapsedFold, ItemMenu, PollView, ReplyCountButton, ShareButton, SupportLink, VoteCluster } from './parts';

export interface BuzzCardProps {
  buzz: Buzz;
  /** Feed: the body links to the thread. */
  linkToThread?: boolean;
  className?: string;
}

export const BuzzCard: FC<BuzzCardProps> = ({ buzz, linkToThread = true, className }) => {
  const navigate = useNavigate();
  const body = (
    <article className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4', className)} aria-label="Buzz">
      <AliasLine
        alias={buzz.alias}
        isMine={buzz.isMine}
        createdAt={buzz.createdAt}
        trailing={
          <div className="flex shrink-0 items-center gap-1">
            {buzz.campusShortName ? <Badge variant="soft" tone="neutral">{buzz.campusShortName}</Badge> : null}
            {buzz.isMine ? <ContentStatusChip status={buzz.status} /> : null}
            <ItemMenu item={buzz} onHidden={() => removeBuzzItem(buzz.id)} className="-mr-2" />
          </div>
        }
      />
      {linkToThread && (buzz.text || buzz.title) ? (
        <button type="button" className="text-left" onClick={() => navigate(routes.buzzThread(buzz.threadId))} aria-label="Open thread">
          <BuzzContent buzz={buzz} clamp />
        </button>
      ) : (
        <BuzzContent buzz={buzz} clamp={linkToThread} />
      )}
      <BuzzMediaView media={buzz.media} />
      {buzz.poll ? <PollView threadId={buzz.threadId} poll={buzz.poll} isMine={buzz.isMine} disabled={buzz.status !== 'active'} /> : null}
      {buzz.supportLink ? <SupportLink /> : null}
      <footer className="flex items-center gap-1">
        <VoteCluster item={buzz} />
        <ReplyCountButton threadId={buzz.threadId} count={buzz.replyCount} />
        <span className="flex-1" />
        <ShareButton item={buzz} />
      </footer>
    </article>
  );
  if (buzz.collapsed && !buzz.isMine) {
    return (
      <div className={cn('rounded-lg border border-line bg-surface-1 p-2', className)}>
        <CollapsedFold id={buzz.id} reason="community">{body}</CollapsedFold>
      </div>
    );
  }
  return body;
};

export const BuzzCardSkeleton: FC<{ className?: string }> = ({ className }) => (
  <div className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4', className)} aria-hidden>
    <div className="flex items-center gap-2">
      <Skeleton w={28} h={28} circle />
      <Skeleton w={110} h={14} />
      <Skeleton w={28} h={12} />
    </div>
    <SkeletonText lines={3} />
    <div className="flex items-center gap-2">
      <Skeleton w={104} h={36} className="rounded-full" />
      <Skeleton w={64} h={20} />
    </div>
  </div>
);

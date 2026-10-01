/**
 * Comments sheet (design §7.2): `['half','full']` detents while the video keeps playing; rows = Avatar sm, name,
 * text, like; one level of replies ("View n replies"); glass composer footer with the inline public
 * `ComposerModeBanner verb="Commenting"` (Constitution §5.4). Report / Block / Delete per comment (OverflowMenu).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ChevronDown, Ellipsis, Heart, MessageCircle, SendHorizontal, X } from 'lucide-react';
import type { WithModeration } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { Reel, ReelComment } from '@shared/reels';
import { Button, EmptyState, ErrorState, IconButton, InfiniteSentinel, Sheet, Skeleton, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, OverflowMenu, TimeAgo, UserAvatar } from '@/components';
import { cn } from '@/lib/cn';
import { formatCount } from '@/lib/format';
import { ContentStatusChip, showModerationNotice } from '@/lib/moderation';
import { prependInfiniteItem, queryClient } from '@/lib/query';
import { useMe } from '@/lib/session';
import {
  createComment, onWriteError, patchReel, reelKeys, useCommentReplies, useDeleteComment, useReelComments, useToggleCommentLike,
} from './api';

export interface CommentsSheetProps {
  reel: Reel | null;
  open: boolean;
  onOpenChange(open: boolean): void;
}

interface ReplyTarget {
  id: string;
  handle: string;
}

export function CommentsSheet({ reel, open, onOpenChange }: CommentsSheetProps) {
  if (!reel) return null;
  return <CommentsBody key={reel.id} reel={reel} open={open} onOpenChange={onOpenChange} />;
}

function CommentsBody({ reel, open, onOpenChange }: { reel: Reel; open: boolean; onOpenChange(o: boolean): void }) {
  const me = useMe();
  const list = useReelComments(reel.id, open);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const post = useMutation<WithModeration<ReelComment>, unknown, { text: string; parentId?: string }>({
    mutationFn: (body) => createComment(reel.id, body),
    onSuccess: (res, body) => {
      const { moderation, ...comment } = res;
      showModerationNotice(moderation);
      if (body.parentId) {
        // a reply: append to the parent's preview (when it has room) and its replies list, bump the counters
        queryClient.setQueriesData<{ pages: { items: ReelComment[]; nextCursor: string | null }[] }>({ queryKey: reelKeys.comments(reel.id) }, (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((p) => ({
                  ...p,
                  items: p.items.map((c) =>
                    c.id === body.parentId
                      ? { ...c, replyCount: c.replyCount + 1, replies: c.replies.length < 2 ? [...c.replies, comment] : c.replies }
                      : c,
                  ),
                })),
              }
            : data,
        );
        queryClient.setQueriesData<{ pages: { items: ReelComment[]; nextCursor: string | null }[] }>({ queryKey: reelKeys.replies(body.parentId) }, (data) =>
          data && data.pages.length > 0
            ? { ...data, pages: data.pages.map((p, i) => (i === data.pages.length - 1 ? { ...p, items: [...p.items.filter((x) => x.id !== comment.id), comment] } : p)) }
            : data,
        );
      } else {
        prependInfiniteItem([...reelKeys.comments(reel.id)], comment);
      }
      if (comment.status === 'active') patchReel(reel.id, (r) => ({ ...r, commentCount: r.commentCount + 1 }));
      setText('');
      setReplyTo(null);
    },
    onError: (e) => onWriteError(e, { onEdit: () => inputRef.current?.focus() }),
  });

  const submit = () => {
    const t = text.trim();
    if (!t || post.isPending) return;
    post.mutate(replyTo ? { text: t, parentId: replyTo.id } : { text: t });
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const startReply = (c: ReelComment) => {
    setReplyTo({ id: c.parentId ?? c.id, handle: c.author.handle });
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!open) setReplyTo(null);
  }, [open]);

  const footer = (
    <ComposerGuard scope="public">
      <div className="flex flex-col gap-2 px-4 pt-2 pb-2">
        {replyTo ? (
          <div className="flex items-center justify-between gap-2 type-caption text-ink-3">
            <span className="truncate">Replying to @{replyTo.handle}</span>
            <IconButton icon={X} aria-label="Cancel reply" size="sm" onClick={() => setReplyTo(null)} />
          </div>
        ) : null}
        <div className="flex items-end gap-2">
          <ComposerModeBanner mode="public" verb="Commenting" size="inline" className="shrink-0 self-center" />
          <Textarea
            ref={inputRef}
            variant="bare"
            minRows={1}
            maxRows={4}
            maxLength={LIMITS.commentText}
            showCount={false}
            placeholder={`Comment as @${me.handle}`}
            aria-label="Write a comment"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            className="min-w-0 flex-1"
          />
          <IconButton
            icon={SendHorizontal}
            aria-label="Post comment"
            variant="accent"
            size="md"
            disabled={!text.trim() || post.isPending}
            onClick={submit}
          />
        </div>
      </div>
    </ComposerGuard>
  );

  const title = reel.commentCount > 0 ? `${formatCount(reel.commentCount)} ${reel.commentCount === 1 ? 'comment' : 'comments'}` : 'Comments';

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} detents={['half', 'full']} footer={footer}>
      <div className="flex min-h-full flex-col">
        {list.isLoading ? (
          <div className="flex flex-col">
            {Array.from({ length: 4 }, (_, i) => (
              <CommentSkeleton key={i} />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState title="Couldn't load comments" error={list.error} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            compact
            icon={MessageCircle}
            title="No comments yet. Say something nice."
            action={{ label: 'Write a comment', onClick: () => inputRef.current?.focus() }}
          />
        ) : (
          <>
            <ul className="flex flex-col">
              {list.items.map((c) => (
                <CommentRow key={c.id} comment={c} reel={reel} onReply={startReply} />
              ))}
            </ul>
            <InfiniteSentinel {...list.sentinelProps} skeleton={<CommentSkeleton />} endLabel={null} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function CommentSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton circle w={32} />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <Skeleton w="35%" h={12} />
        <Skeleton w="85%" h={12} />
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: ReelComment;
  reel: Reel;
  onReply(c: ReelComment): void;
  isReply?: boolean;
}

function CommentRow({ comment, reel, onReply, isReply = false }: CommentRowProps) {
  const me = useMe();
  const like = useToggleCommentLike(reel.id);
  const del = useDeleteComment(reel.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  const replies = useCommentReplies(comment.id, showReplies && !isReply);
  const isSelf = comment.viewer.isSelf;
  const canDelete = isSelf || reel.viewer.isSelf;
  const hiddenReplies = Math.max(0, comment.replyCount - comment.replies.length);

  return (
    <li className={cn('flex flex-col', isReply && 'pl-10')}>
      <div className="flex items-start gap-3 px-4 py-2.5">
        <UserAvatar user={comment.author} size={isReply ? 'xs' : 'sm'} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate type-label-sm text-ink">{comment.author.displayName}</span>
            <TimeAgo ts={comment.createdAt} className="type-caption text-ink-3" />
            {isSelf && comment.status !== 'active' ? <ContentStatusChip status={comment.status} /> : null}
          </div>
          <p className="whitespace-pre-wrap break-words type-body text-ink-2">{comment.text}</p>
          <div className="-ml-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onReply(comment)} className="h-8 px-2 text-ink-3">
              Reply
            </Button>
            <IconButton icon={Ellipsis} aria-label="More" size="sm" onClick={() => setMenuOpen(true)} className="text-ink-3" />
          </div>
        </div>
        <button
          type="button"
          aria-label={comment.viewer.liked ? 'Unlike comment' : 'Like comment'}
          aria-pressed={comment.viewer.liked}
          onClick={() => like.mutate(comment)}
          className={cn('press-icon flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full', comment.viewer.liked ? 'text-love' : 'text-ink-3')}
        >
          <Heart size={16} strokeWidth={2} fill={comment.viewer.liked ? 'currentColor' : 'none'} aria-hidden />
          {comment.likeCount > 0 ? <span className="type-micro tabular-nums">{formatCount(comment.likeCount)}</span> : null}
        </button>
      </div>

      {!isReply && comment.replies.length > 0 && !showReplies ? (
        <ul className="flex flex-col">
          {comment.replies.map((r) => (
            <CommentRow key={r.id} comment={r} reel={reel} onReply={onReply} isReply />
          ))}
        </ul>
      ) : null}
      {!isReply && showReplies ? (
        <ul className="flex flex-col">
          {replies.isLoading
            ? comment.replies.map((r) => <CommentRow key={r.id} comment={r} reel={reel} onReply={onReply} isReply />)
            : replies.items.map((r) => <CommentRow key={r.id} comment={r} reel={reel} onReply={onReply} isReply />)}
          {replies.isError ? <ErrorState inline title="Couldn't load replies" error={replies.error} onRetry={() => void replies.refetch()} /> : null}
          {replies.hasNextPage ? (
            <div className="pl-14">
              <Button variant="ghost" size="sm" loading={replies.isFetchingNextPage} onClick={() => void replies.fetchNextPage()} className="text-accent-ink">
                More replies
              </Button>
            </div>
          ) : null}
        </ul>
      ) : null}
      {!isReply && hiddenReplies > 0 && !showReplies ? (
        <div className="pl-14">
          <Button variant="ghost" size="sm" leftIcon={ChevronDown} onClick={() => setShowReplies(true)} className="text-accent-ink">
            View {hiddenReplies} more {hiddenReplies === 1 ? 'reply' : 'replies'}
          </Button>
        </div>
      ) : null}

      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        report={{ entityType: 'reel_comment', entityId: comment.id, author: isSelf ? null : comment.author }}
        blockUser={isSelf || comment.author.id === me.id ? null : comment.author}
        onDelete={canDelete ? () => del.mutate(comment) : undefined}
        deleteLabel="Delete comment"
      />
    </li>
  );
}

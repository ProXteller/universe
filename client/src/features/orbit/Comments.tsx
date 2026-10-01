/**
 * Comments under a post: flat top-level list (newest first) with one level of replies, Report / Block / Delete per
 * comment through `OverflowMenu`, and the glass comment bar (inline public `ComposerModeBanner verb="Commenting"`).
 */
import { forwardRef, useImperativeHandle, useRef, useState, type FC } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Ellipsis, MessageCircle, Reply, SendHorizontal, Trash2, X } from 'lucide-react';
import type { Id } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { Post, PostComment } from '@shared/orbit';
import { Dialog, EmptyState, ErrorState, IconButton, InfiniteSentinel, Skeleton, SkeletonText, Textarea, VerifiedBadge } from '@/ui';
import { ComposerGuard, ComposerModeBanner, OverflowMenu, TimeAgo, UserAvatar } from '@/components';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { ContentStatusChip, handleModerationError, showModerationNotice } from '@/lib/moderation';
import { prependInfiniteItem, queryClient, removeInfiniteItem, updateInfiniteItem } from '@/lib/query';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { createCommentRequest, deleteCommentRequest, orbitKeys, patchPost, useComments } from './api';

/* ───────────────────────────── list ───────────────────────────── */

export interface CommentListProps {
  post: Post;
  onReply(target: { id: Id; handle: string }): void;
  /** Empty state action: focus the comment bar. */
  onWrite?(): void;
  className?: string;
}

export const CommentList: FC<CommentListProps> = ({ post, onReply, onWrite, className }) => {
  const comments = useComments(post.id);
  if (comments.isLoading) {
    return (
      <div className={cn('flex flex-col', className)} aria-busy="true">
        <CommentSkeleton />
        <CommentSkeleton />
        <CommentSkeleton />
      </div>
    );
  }
  if (comments.isError) return <ErrorState inline title="Couldn't load comments" error={comments.error} onRetry={() => void comments.refetch()} />;
  if (comments.items.length === 0) {
    return (
      <EmptyState
        compact
        icon={MessageCircle}
        title="No comments yet."
        description="Be the first to say something."
        action={onWrite ? { label: 'Write a comment', onClick: onWrite } : undefined}
        className={className}
      />
    );
  }
  return (
    <div className={cn('flex flex-col', className)}>
      <ul aria-label="Comments" className="flex flex-col">
        {comments.items.map((c) => (
          <li key={c.id}>
            <CommentRow comment={c} post={post} onReply={onReply} />
            {c.replies.length > 0 ? (
              <ul className="ml-12 border-l-2 border-line pl-3" aria-label={`Replies to ${c.author.displayName}`}>
                {c.replies.map((r) => (
                  <li key={r.id}>
                    <CommentRow comment={r} post={post} onReply={onReply} reply />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <InfiniteSentinel {...comments.sentinelProps} endLabel={null} skeleton={<CommentSkeleton />} />
    </div>
  );
};

const CommentSkeleton: FC = () => (
  <div className="flex gap-3 px-4 py-3" aria-hidden>
    <Skeleton circle w={32} h={32} />
    <div className="flex flex-1 flex-col gap-1.5">
      <Skeleton w="35%" h={12} />
      <SkeletonText lines={2} />
    </div>
  </div>
);

/* ───────────────────────────── row ───────────────────────────── */

/** Drops a top-level comment, or a reply from its parent's `replies`, in the cached comment pages. */
function dropCommentFromCache(postId: Id, comment: PostComment): void {
  const key = [...orbitKeys.comments(postId)];
  if (comment.parentId === null) {
    removeInfiniteItem(key, comment.id);
    return;
  }
  updateInfiniteItem<PostComment>(key, comment.parentId, (p) => ({
    ...p,
    replyCount: Math.max(0, p.replyCount - (comment.status === 'active' ? 1 : 0)),
    replies: p.replies.filter((r) => r.id !== comment.id),
  }));
}

interface CommentRowProps {
  comment: PostComment;
  post: Post;
  onReply(target: { id: Id; handle: string }): void;
  reply?: boolean;
}

const CommentRow: FC<CommentRowProps> = ({ comment, post, onReply, reply = false }) => {
  const me = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const isSelf = comment.viewer.isSelf || comment.author.id === me.id;
  const canDelete = isSelf || post.viewer.isSelf;
  const remove = useMutation({
    mutationFn: () => deleteCommentRequest(comment.id),
    onSuccess: () => {
      const wasActive = comment.status === 'active';
      const removed = (wasActive ? 1 : 0) + (comment.parentId === null ? comment.replies.filter((r) => r.status === 'active').length : 0);
      dropCommentFromCache(post.id, comment);
      if (removed > 0) patchPost(post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - removed) }));
      toast.success('Comment deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <article className={cn('flex gap-3 px-4 py-3', reply && 'px-0')} aria-label={`Comment by ${comment.author.displayName}`}>
      <UserAvatar user={comment.author} size={reply ? 'xs' : 'sm'} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5 type-caption text-ink-3">
          <span className="truncate type-label-sm text-ink">{comment.author.displayName}</span>
          {comment.author.isVerified ? <VerifiedBadge size={12} /> : null}
          <span className="truncate">@{comment.author.handle}</span>
          <span aria-hidden>·</span>
          <TimeAgo ts={comment.createdAt} />
          {isSelf ? <ContentStatusChip status={comment.status} className="ml-1" /> : null}
        </div>
        <p className="type-body whitespace-pre-wrap break-words text-ink">{comment.text}</p>
        <div className="-ml-2 flex items-center">
          <button
            type="button"
            onClick={() => onReply({ id: comment.id, handle: comment.author.handle })}
            className="-my-1 inline-flex min-h-11 items-center gap-1 rounded-full px-2 type-caption text-ink-3 hover:bg-surface-2 hover:text-ink"
          >
            <Reply size={14} strokeWidth={2} aria-hidden />
            Reply
          </button>
          {!reply && comment.replyCount > 0 ? <span className="type-caption text-ink-4">{comment.replyCount === 1 ? '1 reply' : `${comment.replyCount} replies`}</span> : null}
        </div>
      </div>
      <IconButton icon={Ellipsis} aria-label="More" variant="ghost" size="sm" onClick={() => setMenuOpen(true)} className="-mr-2 self-start" />
      <OverflowMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        report={isSelf ? undefined : { entityType: 'orbit_comment', entityId: comment.id, author: comment.author, onReported: () => dropCommentFromCache(post.id, comment) }}
        blockUser={isSelf ? null : comment.author}
        onDelete={canDelete ? () => setConfirm(true) : undefined}
        deleteLabel="Delete comment"
      />
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Delete this comment?"
        description={comment.parentId === null && comment.replies.length > 0 ? 'Its replies go with it. This can’t be undone.' : 'This can’t be undone.'}
        icon={Trash2}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={() => remove.mutateAsync()}
      />
    </article>
  );
};

/* ───────────────────────────── bar ───────────────────────────── */

export interface CommentBarHandle {
  focus(): void;
}

export interface CommentBarProps {
  post: Post;
  replyTo: { id: Id; handle: string } | null;
  onClearReply(): void;
}

export const CommentBar = forwardRef<CommentBarHandle, CommentBarProps>(function CommentBar({ post, replyTo, onClearReply }, ref) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement | null>(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), []);

  // `replyTo.id` is the comment that was tapped (a reply included): the server stores the new row under the
  // top-level comment and notifies the tapped comment's author; `comment.parentId` in the response is that top-level id
  const send = useMutation({
    mutationFn: () => createCommentRequest(post.id, { text: text.trim(), parentId: replyTo?.id }),
    onSuccess: (res) => {
      const { moderation, ...comment } = res;
      const key = [...orbitKeys.comments(post.id)];
      if (comment.parentId) {
        const parentId = comment.parentId;
        updateInfiniteItem<PostComment>(key, parentId, (p) => ({ ...p, replyCount: p.replyCount + (comment.status === 'active' ? 1 : 0), replies: [...p.replies, comment] }));
      } else if (queryClient.getQueryData(key)) {
        prependInfiniteItem<PostComment>(key, comment);
      } else {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      if (comment.status === 'active') patchPost(post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }));
      setText('');
      onClearReply();
      showModerationNotice(moderation);
    },
    onError: (e) => {
      if (!handleModerationError(e, { onEdit: () => area.current?.focus() })) toast.error(errorMessage(e));
    },
  });

  const canSend = text.trim().length > 0 && !send.isPending;

  return (
    <ComposerGuard scope="public" className="m-3">
      <div className="flex flex-col gap-2 px-3 pt-2 pb-2">
        <div className="flex items-center justify-between gap-2">
          <ComposerModeBanner mode="public" verb="Commenting" size="inline" />
          {replyTo ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-full bg-accent-soft py-1 pr-1 pl-2.5 type-caption text-accent-ink">
              <span className="truncate">Replying to @{replyTo.handle}</span>
              <IconButton icon={X} aria-label="Stop replying" variant="ghost" size="sm" onClick={onClearReply} className="size-6 min-h-0 min-w-0" />
            </span>
          ) : null}
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            ref={area}
            variant="bare"
            aria-label={replyTo ? `Reply to @${replyTo.handle}` : 'Write a comment'}
            placeholder={replyTo ? `Reply to @${replyTo.handle}…` : 'Add a comment…'}
            minRows={1}
            maxRows={5}
            maxLength={LIMITS.commentText}
            showCount={text.length > LIMITS.commentText - 80}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSend) {
                e.preventDefault();
                send.mutate();
              }
            }}
            disabled={send.isPending}
            className="flex-1 rounded-lg bg-surface-2 px-3 py-2"
          />
          <IconButton icon={SendHorizontal} aria-label="Send comment" variant="accent" size="md" disabled={!canSend} onClick={() => send.mutate()} aria-busy={send.isPending} />
        </div>
      </div>
    </ComposerGuard>
  );
});

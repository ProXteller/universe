/**
 * PostCard (design §7.2): NOT boxed — a full-width block under a `line-subtle` divider. Header (avatar, name, @handle ·
 * time, campus chip for other campuses, overflow), text, photo mosaic, poll, action row (like · comment · share; no
 * Save — SPEC §2.3). Optimistic like, double-tap photo like, Report + Block via `OverflowMenu`, delete for own posts.
 */
import { memo, useCallback, useState, type FC, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Ellipsis, Heart, MessageCircle, Share, Trash2 } from 'lucide-react';
import type { UserSummary } from '@shared/core';
import type { Post } from '@shared/orbit';
import { CampusBadge, Dialog, IconButton, Skeleton, SkeletonText, VerifiedBadge } from '@/ui';
import { OverflowMenu, TimeAgo, UserAvatar, UserListSheet } from '@/components';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { openShare } from '@/lib/share';
import { toast } from '@/lib/toast';
import { deletePostRequest, dropPost, orbitKeys, seedPostDetail, useLikeMutation } from './api';
import { PostMedia } from './PostMedia';
import { PostPoll } from './PostPoll';
import { PostText } from './PostText';

export interface PostCardProps {
  post: Post;
  /** `feed` (clamped text, tap → detail) · `detail` (body-lg, no navigation). */
  variant?: 'feed' | 'detail';
  /** Detail: focus the comment bar. */
  onComment?(): void;
  className?: string;
}

function shareInput(post: Post) {
  const title = post.text.trim() ? post.text.trim().slice(0, 80) : `Post by @${post.author.handle}`;
  return { card: { kind: 'post' as const, id: post.id }, url: routes.post(post.id), title, text: post.text.slice(0, 200) };
}

export const PostCard: FC<PostCardProps> = memo(function PostCard({ post, variant = 'feed', onComment, className }) {
  const me = useMe();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const like = useLikeMutation(post);
  const isSelf = post.viewer.isSelf || post.author.id === me.id;
  const otherCampus = post.author.universityId !== me.universityId;
  const detail = variant === 'detail';

  const open = useCallback(() => {
    if (detail) return;
    seedPostDetail(post);
    navigate(routes.post(post.id));
  }, [detail, navigate, post]);

  const toggleLike = useCallback(() => {
    if (like.isPending) return;
    like.mutate(!post.viewer.liked);
  }, [like, post.viewer.liked]);

  const doubleTapLike = useCallback(() => {
    if (!post.viewer.liked && !like.isPending) like.mutate(true);
  }, [like, post.viewer.liked]);

  const remove = useMutation({
    mutationFn: () => deletePostRequest(post.id),
    onSuccess: () => {
      dropPost(post.id);
      toast.success('Post deleted');
      if (detail) navigate(-1);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const stop = (e: MouseEvent) => e.stopPropagation();
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (detail) return;
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  };

  const author: UserSummary = post.author;

  return (
    <article
      className={cn('relative flex flex-col gap-3 px-4 py-3.5', !detail && 'cursor-pointer', className)}
      onClick={detail ? undefined : open}
      onKeyDown={onKey}
      tabIndex={detail ? undefined : 0}
      aria-label={detail ? undefined : `Post by ${author.displayName}`}
      data-post-id={post.id}
    >
      {/* header */}
      <header className="flex items-center gap-3">
        <UserAvatar user={author} size="md" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Link
            to={routes.profile(author.handle)}
            onClick={stop}
            aria-label={`${author.displayName}, @${author.handle}`}
            className="flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-sm"
          >
            <span className="truncate type-headline text-ink">{author.displayName}</span>
            {author.isVerified ? <VerifiedBadge size={14} /> : null}
          </Link>
          <span className="flex min-w-0 items-center gap-1.5 type-caption text-ink-3">
            <span className="truncate">@{author.handle}</span>
            <span aria-hidden>·</span>
            <TimeAgo ts={post.createdAt} />
            {otherCampus ? <CampusBadge name={author.universityShortName} className="ml-1" /> : null}
          </span>
        </div>
        {isSelf ? <ContentStatusChip status={post.status} /> : null}
        <span onClick={stop}>
          <IconButton icon={Ellipsis} aria-label="More" variant="ghost" size="sm" onClick={() => setMenuOpen(true)} />
        </span>
      </header>

      {/* body */}
      <PostText text={post.text} clamp={!detail} size={detail ? 'body-lg' : 'body'} />
      {post.images.length > 0 ? <PostMedia images={post.images} onDoubleTap={doubleTapLike} /> : null}
      {post.poll ? <PostPoll postId={post.id} poll={post.poll} isSelf={isSelf} /> : null}

      {/* actions */}
      <div className="-ml-2 flex items-center gap-1" onClick={stop}>
        <ActionButton
          icon={Heart}
          label={post.viewer.liked ? 'Unlike' : 'Like'}
          count={post.likeCount}
          active={post.viewer.liked}
          tone="love"
          onClick={toggleLike}
          onCountClick={post.likeCount > 0 ? () => setLikersOpen(true) : undefined}
        />
        <ActionButton
          icon={MessageCircle}
          label="Comments"
          count={post.commentCount}
          onClick={() => {
            if (detail) onComment?.();
            else {
              seedPostDetail(post);
              navigate(routes.post(post.id));
            }
          }}
        />
        <ActionButton icon={Share} label="Share" onClick={() => openShare(shareInput(post))} />
      </div>

      {/* portaled overlays: React events bubble through portals, so this wrapper keeps their clicks off the card */}
      <div className="contents" onClick={stop}>
        <OverflowMenu
          open={menuOpen}
          onOpenChange={setMenuOpen}
          share={shareInput(post)}
          report={isSelf ? undefined : { entityType: 'orbit_post', entityId: post.id, author, onReported: () => dropPost(post.id) }}
          blockUser={isSelf ? null : author}
          onDelete={isSelf ? () => setConfirmDelete(true) : undefined}
          deleteLabel="Delete post"
        />
        <Dialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this post?"
          description="It disappears from your Orbit and your profile. This can't be undone."
          icon={Trash2}
          tone="danger"
          confirmLabel="Delete"
          onConfirm={() => remove.mutateAsync()}
        />
        <UserListSheet
          open={likersOpen}
          onOpenChange={setLikersOpen}
          title="Liked by"
          path={`/orbit/posts/${encodeURIComponent(post.id)}/likers`}
          queryKey={[...orbitKeys.likers(post.id)]}
          emptyTitle="No likes yet"
        />
      </div>
    </article>
  );
});

interface ActionButtonProps {
  icon: typeof Heart;
  label: string;
  count?: number;
  active?: boolean;
  tone?: 'accent' | 'love';
  onClick(): void;
  onCountClick?(): void;
}

const ActionButton: FC<ActionButtonProps> = ({ icon, label, count, active = false, tone = 'accent', onClick, onCountClick }) => (
  <span className="flex items-center">
    <IconButton icon={icon} aria-label={label} variant="ghost" size="md" active={active} activeTone={tone} onClick={onClick} />
    {count !== undefined && count > 0 ? (
      onCountClick ? (
        <button type="button" onClick={onCountClick} className="-ml-1.5 min-h-11 pr-2 type-caption tabular-nums text-ink-2 hover:text-ink" aria-label={`${count} ${label.toLowerCase()}`}>
          {formatCount(count)}
        </button>
      ) : (
        <span className="-ml-1.5 pr-2 type-caption tabular-nums text-ink-2">{formatCount(count)}</span>
      )
    ) : null}
  </span>
);

/** Geometry-matching skeleton (header + 3 lines + a 4:5 media box on every second row). */
export const PostSkeleton: FC<{ media?: boolean }> = ({ media = false }) => (
  <div className="flex flex-col gap-3 px-4 py-3.5" aria-hidden>
    <div className="flex items-center gap-3">
      <Skeleton circle w={44} h={44} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton w="40%" h={14} />
        <Skeleton w="28%" h={10} />
      </div>
    </div>
    <SkeletonText lines={media ? 2 : 3} />
    {media ? (
      <div className="w-full" style={{ aspectRatio: '4 / 5' }}>
        <Skeleton className="size-full rounded-lg" h="100%" />
      </div>
    ) : null}
    <div className="flex items-center gap-4 pt-1">
      <Skeleton w={56} h={20} className="rounded-full" />
      <Skeleton w={56} h={20} className="rounded-full" />
      <Skeleton w={40} h={20} className="rounded-full" />
    </div>
  </div>
);

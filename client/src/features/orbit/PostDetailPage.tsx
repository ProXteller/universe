/**
 * `/post/:id` (design §7.2 "Post detail"): compact header, the post at `type-body-lg`, comments list, and the glass
 * comment bar as the Screen footer. The feed seeds the detail cache so navigation paints instantly.
 */
import { useCallback, useRef, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquareOff } from 'lucide-react';
import type { Id } from '@shared/core';
import { EmptyState, ErrorState, PageHeader, Screen, Skeleton, SkeletonText } from '@/ui';
import { isApiError } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { usePost } from './api';
import { CommentBar, CommentList, type CommentBarHandle } from './Comments';
import { PostCard } from './PostCard';

export const PostDetailPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  return <PostDetail key={id} id={id} />;
};

const PostDetail: FC<{ id: Id }> = ({ id }) => {
  const navigate = useNavigate();
  const post = usePost(id);
  const bar = useRef<CommentBarHandle | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: Id; handle: string } | null>(null);
  useScreenView('post_detail');

  const reply = useCallback((target: { id: Id; handle: string }) => {
    setReplyTo(target);
    bar.current?.focus();
  }, []);

  const gone = post.isError && isApiError(post.error) && post.error.status === 404;

  return (
    <Screen
      header={<PageHeader title="Post" back mode="compact" />}
      footer={post.data ? <CommentBar ref={bar} post={post.data} replyTo={replyTo} onClearReply={() => setReplyTo(null)} /> : undefined}
    >
      {post.isLoading ? (
        <div className="flex flex-col gap-3 px-4 py-3.5" aria-busy="true" aria-label="Loading post">
          <div className="flex items-center gap-3">
            <Skeleton circle w={44} h={44} />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton w="40%" h={14} />
              <Skeleton w="28%" h={10} />
            </div>
          </div>
          <SkeletonText lines={4} />
        </div>
      ) : gone ? (
        <EmptyState
          icon={MessageSquareOff}
          title="This post isn't available"
          description="It may have been deleted, or it's from someone you can't see."
          action={{ label: 'Back to Orbit', onClick: () => navigate(routes.home('orbit')) }}
        />
      ) : post.isError || !post.data ? (
        <ErrorState title="Couldn't load this post" error={post.error} onRetry={() => void post.refetch()} />
      ) : (
        <>
          <PostCard post={post.data} variant="detail" onComment={() => bar.current?.focus()} />
          <div className="border-t border-line-subtle">
            <CommentList post={post.data} onReply={reply} onWrite={() => bar.current?.focus()} />
          </div>
        </>
      )}
    </Screen>
  );
};

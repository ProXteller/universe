/**
 * `UserPostsList` (SPEC §4.6 / §5.4): the Posts tab of a profile. Embedded in discover's `<Screen>` — it MUST NOT
 * create its own scroll container, so the sentinel resolves the enclosing Screen's scroller.
 */
import { useState, type FC } from 'react';
import { MessageSquareText } from 'lucide-react';
import type { UserContentProps } from '@/app/contracts';
import { EmptyState, ErrorState, InfiniteSentinel } from '@/ui';
import { useUserPosts } from './api';
import { PostCard, PostSkeleton } from './PostCard';
import { PostComposer } from './PostComposer';

export const UserPostsList: FC<UserContentProps> = ({ userId, handle, isSelf }) => {
  const posts = useUserPosts(userId);
  const [composerOpen, setComposerOpen] = useState(false);

  if (posts.isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading posts">
        <PostSkeleton />
        <PostSkeleton media />
      </div>
    );
  }
  if (posts.isError) return <ErrorState title="Couldn't load posts" error={posts.error} onRetry={() => void posts.refetch()} />;
  if (posts.items.length === 0) {
    return (
      <>
        {isSelf ? (
          <EmptyState
            compact
            icon={MessageSquareText}
            title="Nothing posted yet"
            description="Your public posts show up here."
            action={{ label: 'Write a post', onClick: () => setComposerOpen(true) }}
          />
        ) : (
          <EmptyState compact icon={MessageSquareText} title={`@${handle} hasn't posted yet.`} />
        )}
        {isSelf ? <PostComposer open={composerOpen} onOpenChange={setComposerOpen} /> : null}
      </>
    );
  }
  return (
    <div className="flex flex-col">
      <ul className="flex flex-col" aria-label={`Posts by @${handle}`}>
        {posts.items.map((post) => (
          <li key={post.id} className="border-b border-line-subtle last:border-b-0">
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <InfiniteSentinel {...posts.sentinelProps} endLabel={null} skeleton={<PostSkeleton />} />
    </div>
  );
};

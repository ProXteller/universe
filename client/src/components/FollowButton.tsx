import { forwardRef, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Check, Plus } from 'lucide-react';
import type { FollowResult, Id, PublicUser } from '@shared/core';
import { Button } from '@/ui';
import { cn } from '@/lib/cn';
import { api, errorMessage, isApiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { useSpringPreset } from '@/lib/motion';
import { queryClient } from '@/lib/query';
import { useMeOptional } from '@/lib/session';
import { toast } from '@/lib/toast';

export interface FollowButtonProps {
  userId: Id;
  initialFollowing: boolean;
  /** They follow the viewer → label "Follow back". */
  followsMe?: boolean;
  size?: 'sm' | 'md';
  /** `'plus-badge'` = the small round + badge on the reel rail avatar. */
  variant?: 'default' | 'plus-badge';
  onChange?(r: FollowResult): void;
  className?: string;
}

/** Reserved keys refreshed after a follow / unfollow (SPEC §4.4.5). */
function invalidateFollowKeys(userId: Id): void {
  void queryClient.invalidateQueries({ queryKey: ['users', userId] });
  void queryClient.invalidateQueries({ queryKey: ['orbit', 'feed'] });
  void queryClient.invalidateQueries({ queryKey: ['reels', 'following'] });
  void queryClient.invalidateQueries({ queryKey: ['users', 'handle'] });
}

/** Optimistic follow / unfollow with a spring morph. Renders nothing for the viewer themself. */
export const FollowButton = forwardRef<HTMLButtonElement, FollowButtonProps>(function FollowButton(
  { userId, initialFollowing, followsMe = false, size = 'sm', variant = 'default', onChange, className },
  ref,
) {
  const me = useMeOptional();
  const [following, setFollowing] = useState(initialFollowing);
  const spring = useSpringPreset('snappy');
  useEffect(() => setFollowing(initialFollowing), [initialFollowing, userId]);

  const mutation = useMutation<FollowResult, unknown, boolean>({
    mutationFn: (next) => (next ? api.post<FollowResult>(`/users/${encodeURIComponent(userId)}/follow`) : api.delete<FollowResult>(`/users/${encodeURIComponent(userId)}/follow`)),
    onMutate: (next) => {
      setFollowing(next);
      track(next ? 'follow' : 'unfollow', { userId });
    },
    onSuccess: (r) => {
      setFollowing(r.isFollowing);
      queryClient.setQueriesData<PublicUser>({ queryKey: ['users', userId] }, (u) =>
        u ? { ...u, followerCount: r.followerCount, viewer: { ...u.viewer, isFollowing: r.isFollowing } } : u,
      );
      invalidateFollowKeys(userId);
      onChange?.(r);
    },
    onError: (e, next) => {
      setFollowing(!next);
      if (isApiError(e) && e.status === 404) toast.error("This account isn't available.");
      else toast.error(errorMessage(e));
    },
  });

  if (!me || me.id === userId) return null;

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (mutation.isPending) return;
    mutation.mutate(!following);
  };

  if (variant === 'plus-badge') {
    return (
      <motion.button
        ref={ref}
        type="button"
        aria-label={following ? 'Following' : 'Follow'}
        aria-pressed={following}
        onClick={toggle}
        initial={false}
        animate={{ scale: 1, backgroundColor: following ? 'var(--color-surface-4)' : 'var(--color-accent)' }}
        whileTap={{ scale: 0.9 }}
        transition={spring}
        className={cn(
          'flex size-5 items-center justify-center rounded-full text-on-accent ring-2 ring-canvas before:absolute before:-inset-2',
          'relative',
          className,
        )}
      >
        {following ? <Check size={12} strokeWidth={3} aria-hidden /> : <Plus size={12} strokeWidth={3} aria-hidden />}
      </motion.button>
    );
  }

  const label = following ? 'Following' : followsMe ? 'Follow back' : 'Follow';
  return (
    <motion.span layout transition={spring} className="inline-flex shrink-0">
      <Button
        ref={ref}
        size={size}
        variant={following ? 'secondary' : 'primary'}
        aria-pressed={following}
        onClick={toggle}
        className={cn('min-w-[84px]', className)}
      >
        {label}
      </Button>
    </motion.span>
  );
});

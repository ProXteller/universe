/**
 * BlockDialog + host (SPEC §4.4.2, safety §7.1). Silent, symmetric, immediate. `POST /users/:id/block`, then the
 * reserved keys are invalidated so every public surface drops the user.
 */
import { forwardRef, useEffect, useState } from 'react';
import { Ban } from 'lucide-react';
import type { BlockResult, PublicUser, UserSummary } from '@shared/core';
import { Dialog } from '@/ui';
import { api, errorMessage, isApiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { useUiStore } from '@/stores/ui';

export interface BlockDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  user: UserSummary;
  onBlocked?(result: BlockResult): void;
  className?: string;
}

/** Reserved keys refreshed after a block (SPEC §4.4.5) plus the inbox / notifications the block prunes. */
export function invalidateAfterBlock(userId: string): void {
  void queryClient.invalidateQueries({ queryKey: ['users', userId] });
  void queryClient.invalidateQueries({ queryKey: ['users', 'handle'] });
  void queryClient.invalidateQueries({ queryKey: ['orbit', 'feed'] });
  void queryClient.invalidateQueries({ queryKey: ['reels', 'following'] });
  void queryClient.invalidateQueries({ queryKey: ['messages'] });
  void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  void queryClient.invalidateQueries({ queryKey: ['badges'] });
}

export async function blockUser(user: UserSummary): Promise<BlockResult> {
  const result = await api.post<BlockResult>(`/users/${encodeURIComponent(user.id)}/block`);
  queryClient.setQueriesData<PublicUser>({ queryKey: ['users', user.id] }, (u) =>
    u
      ? {
          ...u,
          bio: '',
          followerCount: 0,
          followingCount: 0,
          postCount: 0,
          reelCount: 0,
          viewer: { ...u.viewer, isFollowing: false, isFollowedBy: false, isBlockedByMe: true, mutualCount: 0, mutualSample: [] },
        }
      : u,
  );
  invalidateAfterBlock(user.id);
  track('block', { userId: user.id });
  return result;
}

export const BlockDialog = forwardRef<HTMLDivElement, BlockDialogProps>(function BlockDialog(
  { open, onOpenChange, user, onBlocked, className },
  ref,
) {
  const confirm = async () => {
    try {
      const result = await blockUser(user);
      toast.success(`Blocked @${user.handle}`);
      if (result.sharedGroupConversationIds.length > 0) {
        const n = result.sharedGroupConversationIds.length;
        toast.info(`You still share ${n} group chat${n === 1 ? '' : 's'} with them. You can leave from the chat info.`, { duration: 7000 });
      }
      onBlocked?.(result);
    } catch (e) {
      if (isApiError(e, 'conflict')) toast.error("You've reached the block limit.");
      else if (isApiError(e) && e.status === 404) toast.error("This account isn't available.");
      else toast.error(errorMessage(e));
      throw e;
    }
  };

  return (
    <Dialog
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      icon={Ban}
      tone="danger"
      title={`Block @${user.handle}?`}
      description="They won't see your profile, posts, reels, listings or messages, and you won't see theirs. They won't be told. You can unblock them in Settings → Privacy & safety."
      confirmLabel="Block"
      onConfirm={confirm}
      className={className}
    />
  );
});

/** Mounted once by AppShell. */
export function BlockHost() {
  const request = useUiStore((s) => s.block);
  const closeBlock = useUiStore((s) => s.closeBlock);
  const [last, setLast] = useState(request);
  useEffect(() => {
    if (request) setLast(request);
  }, [request]);
  const current = request ?? last;
  if (!current) return null;
  return (
    <BlockDialog
      open={request !== null}
      onOpenChange={(o) => (o ? undefined : closeBlock())}
      user={current.user}
      onBlocked={() => {
        current.onBlocked?.();
      }}
    />
  );
}

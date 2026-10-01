/**
 * Settings → Blocked users: foundation #15 list with an inline Unblock (#26) per row.
 */
import type { FC } from 'react';
import { Ban } from 'lucide-react';
import type { BlockedUserRow } from '@shared/core';
import { Button, EmptyState, ErrorState, InfiniteSentinel, Skeleton } from '@/ui';
import { UserRow } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useBlockedUsers, useUnblock } from '../api';
import { SettingsScreen } from './shared';

const Row: FC<{ row: BlockedUserRow }> = ({ row }) => {
  const unblock = useUnblock();
  return (
    <UserRow
      user={row.user}
      subtitle={`@${row.user.handle} · blocked ${formatDate(row.blockedAt)}`}
      trailing={
        <Button
          variant="secondary"
          size="sm"
          loading={unblock.isPending}
          onClick={() =>
            unblock.mutate(row.user.id, {
              onSuccess: () => toast.success(`Unblocked @${row.user.handle}`),
              onError: (e) => toast.error(errorMessage(e)),
            })
          }
        >
          Unblock
        </Button>
      }
    />
  );
};

const RowSkeleton: FC = () => (
  <div className="flex min-h-17 items-center gap-3 px-4">
    <Skeleton w={44} h={44} circle />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton w="45%" h={14} />
      <Skeleton w="65%" h={10} />
    </div>
    <Skeleton w={76} h={36} className="rounded-full" />
  </div>
);

export const BlockedUsersPage: FC = () => {
  const list = useBlockedUsers();
  useScreenView('settings_blocked');

  return (
    <SettingsScreen title="Blocked users" className="px-0">
      {list.isLoading ? (
        <div className="flex flex-col">
          {Array.from({ length: 4 }, (_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        <EmptyState icon={Ban} title="You haven't blocked anyone." description="Blocked accounts can't see your profile, posts or messages." />
      ) : (
        <div className="flex flex-col">
          {list.items.map((row) => (
            <Row key={row.user.id} row={row} />
          ))}
          <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
        </div>
      )}
    </SettingsScreen>
  );
};

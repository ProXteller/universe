/**
 * UserListSheet (SPEC §4.4.2): likers, attendees, any endpoint that returns `Paginated<UserListItem>`.
 */
import { forwardRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { UserListItem } from '@shared/core';
import { EmptyState, ErrorState, InfiniteSentinel, Sheet, Skeleton } from '@/ui';
import { routes } from '@/lib/links';
import { useInfiniteList } from '@/lib/query';
import { UserRow } from './UserRow';

export interface UserListSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  /** Endpoint (relative to `/api`) returning `Paginated<UserListItem>`. */
  path: string;
  queryKey: unknown[];
  /** Empty-state copy. Default "Nobody yet". */
  emptyTitle?: string;
  className?: string;
}

function RowSkeleton() {
  return (
    <div className="flex min-h-16 items-center gap-3 px-4 py-2">
      <Skeleton circle w={40} h={40} />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton w="45%" h={12} />
        <Skeleton w="30%" h={10} />
      </div>
      <Skeleton w={84} h={36} className="rounded-full" />
    </div>
  );
}

export const UserListSheet = forwardRef<HTMLDivElement, UserListSheetProps>(function UserListSheet(
  { open, onOpenChange, title, path, queryKey, emptyTitle = 'Nobody yet', className },
  ref,
) {
  const navigate = useNavigate();
  const list = useInfiniteList<UserListItem>({ queryKey, path, enabled: open });

  return (
    <Sheet ref={ref} open={open} onOpenChange={onOpenChange} title={title} detents={['half', 'full']} className={className}>
      {/* The sentinel observes against the sheet body: `Sheet` provides its own Screen context (scrollEl = body). */}
      <div className="-mx-4">
        {list.isLoading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : list.isError ? (
          <ErrorState title={`Couldn't load ${title.toLowerCase()}`} error={list.error} onRetry={() => void list.refetch()} />
        ) : list.items.length === 0 ? (
          <EmptyState compact icon={Users} title={emptyTitle} />
        ) : (
          <>
            {list.items.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                onClick={() => {
                  onOpenChange(false);
                  navigate(routes.profile(u.handle));
                }}
              />
            ))}
            <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
          </>
        )}
      </div>
    </Sheet>
  );
});

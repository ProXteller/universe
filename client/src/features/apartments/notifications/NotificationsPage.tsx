/**
 * Notifications center (SPEC §5.10, design §7.9, product §2.10): groups Today / This week / Earlier, chips =
 * `NOTIFICATION_FILTERS`, rows per §4.4.4. Anonymous (Buzz) rows lead with the mask disc and NEVER render `UserAvatar`.
 * Tap → mark read + navigate `href`; "Mark all read"; inline Follow back on `follow.new`; ws `notification` prepends.
 * List key is the reserved `['notifications', filter]`.
 */
import { useCallback, useMemo, useState, type FC, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck, Inbox, VenetianMask } from 'lucide-react';
import type { Notification, NotificationFilter } from '@shared/core';
import { Button, ChipGroup, EmptyState, ErrorState, IconButton, InfiniteSentinel, ListRow, PageHeader, Screen, Skeleton } from '@/ui';
import { FollowButton, MediaBox, UserAvatar } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';
import { routes } from '@/lib/links';
import { toast } from '@/lib/toast';
import { markNotificationsRead, prependNotification, useNotifications } from '../api';
import { notificationView } from './copy';

const FILTERS: readonly { value: NotificationFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'replies', label: 'Replies' },
  { value: 'follows', label: 'Follows' },
  { value: 'marketplace', label: 'Marketplace' },
  { value: 'events', label: 'Events' },
];

const DAY = 24 * 3_600_000;
type Group = 'Today' | 'This week' | 'Earlier';

function groupOf(ts: number, now: number): Group {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (ts >= start.getTime()) return 'Today';
  if (ts >= now - 7 * DAY) return 'This week';
  return 'Earlier';
}

/** 40px leading: mask disc (Buzz), actor avatar + 16px type glyph (public), or a neutral icon disc (system). */
const Leading: FC<{ n: Notification }> = ({ n }) => {
  const { icon: Icon } = notificationView(n);
  if (n.anonymous) {
    return (
      <span aria-label="Anonymous" role="img" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-incog-surface-2 text-incog-500">
        <VenetianMask size={20} strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  if (n.actor) {
    return (
      <span className="relative shrink-0">
        <UserAvatar user={n.actor} size="md" link={false} />
        <span aria-hidden className="absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full bg-surface-3 text-ink ring-2 ring-canvas">
          <Icon size={10} strokeWidth={2.25} />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2">
      <Icon size={20} strokeWidth={1.75} />
    </span>
  );
};

const Row: FC<{ n: Notification; onOpen(n: Notification, href?: string): void }> = ({ n, onOpen }) => {
  const view = notificationView(n);
  const followBack = !n.anonymous && n.type === 'follow.new' && n.actor;
  const trailing: ReactNode = followBack && n.actor ? (
    <FollowButton userId={n.actor.id} initialFollowing={n.actorFollowedByViewer} followsMe size="sm" />
  ) : n.thumbnailUrl ? (
    <MediaBox src={n.thumbnailUrl} alt="" aspect="1:1" rounded="sm" className="w-10" />
  ) : undefined;

  return (
    <ListRow
      leading={<Leading n={n} />}
      title={<span className="whitespace-normal line-clamp-2 type-body">{view.title}</span>}
      subtitle={
        view.subtitle || view.hint ? (
          <span className="flex min-w-0 flex-col">
            {view.subtitle ? <span className="truncate">{view.subtitle}</span> : null}
            {view.hint ? (
              <button
                type="button"
                className="relative z-[1] self-start type-caption text-accent-ink"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(n, routes.guidelines());
                }}
              >
                {view.hint}
              </button>
            ) : null}
          </span>
        ) : undefined
      }
      meta={timeAgo(n.createdAt)}
      trailing={trailing}
      unread={!n.read}
      onClick={() => onOpen(n)}
      className={cn(!n.read && 'bg-surface-1')}
    />
  );
};

const RowSkeleton: FC = () => (
  <div className="flex min-h-17 items-center gap-3 px-4">
    <Skeleton w={40} h={40} circle />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton w="72%" h={14} />
      <Skeleton w="40%" h={12} />
    </div>
    <Skeleton w={24} h={10} />
  </div>
);

export const NotificationsScreen: FC = () => {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const list = useNotifications(filter);
  const [markingAll, setMarkingAll] = useState(false);
  useScreenView('notifications', { filter });

  useRealtime('notification', (e) => prependNotification(e.notification));

  const open = useCallback(
    (n: Notification, href?: string) => {
      if (!n.read) void markNotificationsRead([n.id]).catch(() => undefined);
      navigate(href ?? n.href);
    },
    [navigate],
  );

  const markAll = async () => {
    setMarkingAll(true);
    try {
      await markNotificationsRead('all');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setMarkingAll(false);
    }
  };

  const now = Date.now();
  const grouped = useMemo(() => {
    const out: { group: Group; items: Notification[] }[] = [];
    for (const n of list.items) {
      const g = groupOf(n.createdAt, now);
      const last = out[out.length - 1];
      if (last && last.group === g) last.items.push(n);
      else out.push({ group: g, items: [n] });
    }
    return out;
  }, [list.items, now]);

  const hasUnread = list.items.some((n) => !n.read);
  const filterLabel = FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? filter;

  let body: ReactNode;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col pt-2">
        <div className="px-4 pb-2 pt-3">
          <Skeleton w={48} h={11} />
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body =
      filter === 'all' ? (
        <EmptyState icon={Inbox} title="Nothing yet." description="Follows, replies and offers land here." />
      ) : (
        <EmptyState icon={BellOff} title={`No ${filterLabel} notifications.`} action={{ label: 'Show all', onClick: () => setFilter('all') }} />
      );
  } else {
    body = (
      <div className="flex flex-col pb-2">
        {grouped.map((g) => (
          <section key={g.group} aria-label={g.group}>
            <h2 className="px-4 pb-1 pt-4 type-overline text-ink-3">{g.group}</h2>
            <div className="flex flex-col">
              {g.items.map((n) => (
                <Row key={n.id} n={n} onOpen={open} />
              ))}
            </div>
          </section>
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
      </div>
    );
  }

  return (
    <Screen
      nav
      header={
        <PageHeader
          title="Notifications"
          mode="compact"
          back
          actions={
            hasUnread ? (
              <Button variant="ghost" size="sm" leftIcon={CheckCheck} loading={markingAll} onClick={() => void markAll()} className="text-accent-ink">
                Mark all read
              </Button>
            ) : (
              <IconButton icon={CheckCheck} aria-label="All caught up" disabled />
            )
          }
          below={
            <div className="bg-canvas px-4 py-2">
              <ChipGroup options={FILTERS} value={filter} onChange={(v: NotificationFilter) => setFilter(v)} scroll="x" size="sm" aria-label="Filter notifications" />
            </div>
          }
        />
      }
    >
      {body}
    </Screen>
  );
};

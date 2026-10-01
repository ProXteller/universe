/**
 * Saved — the viewer's silently saved posts (owners are never notified). Same cards as Browse.
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { EmptyState, ErrorState, InfiniteSentinel, PageHeader, Screen } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { removeInfiniteItem } from '@/lib/query';
import { useMe } from '@/lib/session';
import { roommateKeys, useSaved, useSaveToggle } from './api';
import { RoommateCardSkeleton, RoommateCardView, useMessageRoommate } from './parts';
import { RoommatesTabs } from './tabs';

export const SavedPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  useScreenView('roommates_saved');
  const list = useSaved();
  const save = useSaveToggle();
  const messaging = useMessageRoommate();

  const header = (
    <PageHeader
      title="Roommates"
      subtitle={me.university.shortName}
      mode="large"
      below={
        <div className="bg-canvas pb-2">
          <RoommatesTabs value="saved" />
        </div>
      }
    />
  );

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-4 px-4">
        {Array.from({ length: 2 }, (_, i) => (
          <RoommateCardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = (
      <EmptyState
        icon={Bookmark}
        title="Save people you'd want to live with."
        description="They won't be notified."
        action={{ label: 'Browse', onClick: () => navigate(routes.roommates()) }}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-4 px-4">
        {list.items.map((card) => (
          <RoommateCardView
            key={card.id}
            card={card}
            onToggleSave={(c) => {
              save.mutate({ id: c.id, saved: !c.saved });
              if (c.saved) removeInfiniteItem([...roommateKeys.saved()], c.id);
            }}
            onMessage={(c) => messaging.start(c)}
            onReported={(id) => removeInfiniteItem([...roommateKeys.lists()], id)}
          />
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RoommateCardSkeleton />} endLabel={null} />
      </div>
    );
  }

  return (
    <Screen nav header={header} className="gap-4 pt-2">
      {body}
      {messaging.sheet}
    </Screen>
  );
};

/**
 * `/market/mine` (design §7.6 "My listings"): Tabs Active · Closed; rows with a 56px thumb, title, price, state,
 * views · saves · chats; overflow → Edit / Mark sold|returned / Relist / Delete (danger Dialog). Held / hidden /
 * removed rows carry the `ContentStatusChip`.
 */
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Ellipsis, Package, Pencil, Plus, RotateCcw, Tag, Trash2 } from 'lucide-react';
import type { MyListingCard, MyListingsState } from '@shared/market';
import { ActionSheet, Dialog, EmptyState, ErrorState, IconButton, InfiniteSentinel, ListRow, PageHeader, Screen, Skeleton, Tabs, type ActionSheetAction } from '@/ui';
import { MediaBox } from '@/components';
import { errorMessage } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { formatCount } from '@/lib/format';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { toast } from '@/lib/toast';
import { deleteListingRequest, dropListing, invalidateMarketLists, markClosedRequest, relistRequest, seedListingDetail, useMine } from './api';
import { closeState, MARKET_COPY, priceLine, stateLabel } from './labels';

const TABS: readonly { value: MyListingsState; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
];

export const MyListingsPage: FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<MyListingsState>('active');
  const [menuFor, setMenuFor] = useState<MyListingCard | null>(null);
  const [deleteFor, setDeleteFor] = useState<MyListingCard | null>(null);
  const list = useMine(tab);
  useScreenView('market_mine', { tab });

  const close = useMutation({
    mutationFn: (l: MyListingCard) => markClosedRequest(l.id, closeState(l.type)),
    onSuccess: (res) => {
      seedListingDetail(res);
      invalidateMarketLists();
      toast.success(res.state === 'sold' ? 'Marked as sold' : 'Marked as returned');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const relist = useMutation({
    mutationFn: (l: MyListingCard) => relistRequest(l.id),
    onSuccess: (res) => {
      seedListingDetail(res);
      invalidateMarketLists();
      toast.success('Back on the Marketplace for 30 days');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: (l: MyListingCard) => deleteListingRequest(l.id),
    onSuccess: (_res, l) => {
      dropListing(l.id);
      invalidateMarketLists();
      toast.success('Listing deleted');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const actionsFor = (l: MyListingCard): ActionSheetAction[] => {
    const out: ActionSheetAction[] = [{ icon: Pencil, label: 'Edit', onSelect: () => navigate(routes.listingEdit(l.id)) }];
    if (l.state === 'active') out.push({ icon: Tag, label: closeState(l.type) === 'sold' ? 'Mark sold' : 'Mark returned', onSelect: () => close.mutate(l) });
    else out.push({ icon: RotateCcw, label: 'Relist', onSelect: () => relist.mutate(l) });
    out.push({ icon: Trash2, label: 'Delete', destructive: true, onSelect: () => setDeleteFor(l) });
    return out;
  };

  const header = (
    <PageHeader
      title="My listings"
      mode="compact"
      back
      actions={<IconButton icon={Plus} aria-label="New listing" onClick={() => navigate(routes.listingNew())} />}
      below={<Tabs<MyListingsState> value={tab} onChange={setTab} tabs={TABS} aria-label="My listings" />}
    />
  );

  return (
    <Screen header={header}>
      {list.isLoading ? (
        <div className="flex flex-col" aria-busy="true" aria-label="Loading your listings">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton w={56} h={56} className="rounded-md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton w="60%" h={14} />
                <Skeleton w="35%" h={12} />
                <Skeleton w="50%" h={10} />
              </div>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState title="Couldn't load your listings" error={list.error} onRetry={() => void list.refetch()} />
      ) : list.items.length === 0 ? (
        tab === 'active' ? (
          <EmptyState icon={Package} title="Nothing listed" description={MARKET_COPY.mineEmpty} action={{ label: 'List an item', onClick: () => navigate(routes.listingNew()) }} />
        ) : (
          <EmptyState icon={Package} title="Nothing closed yet" description="Sold, returned and expired listings land here. Relist anything to put it back for 30 days." compact />
        )
      ) : (
        <>
          <ul className="flex flex-col">
            {list.items.map((l) => {
              const closed = stateLabel(l.state);
              return (
                <li key={l.id}>
                  <ListRow
                    leading={<MediaBox src={l.coverUrl} alt="" aspect="1:1" rounded="md" className="w-14 shrink-0" />}
                    title={<span className="truncate">{l.title}</span>}
                    subtitle={
                      <span className="flex flex-col">
                        <span className="truncate tabular-nums">
                          {priceLine(l)}
                          {closed ? ` · ${closed}` : ''}
                        </span>
                        <span className="type-caption tabular-nums text-ink-3">
                          {formatCount(l.stats.views)} views · {formatCount(l.stats.saves)} saves · {formatCount(l.stats.chats)} chats
                        </span>
                      </span>
                    }
                    meta={<ContentStatusChip status={l.status} />}
                    trailing={<IconButton icon={Ellipsis} aria-label={`Actions for ${l.title}`} size="sm" onClick={() => setMenuFor(l)} />}
                    onClick={() => navigate(routes.listing(l.id))}
                  />
                </li>
              );
            })}
          </ul>
          <InfiniteSentinel {...list.sentinelProps} endLabel={null} />
        </>
      )}
      <ActionSheet open={menuFor !== null} onOpenChange={(o) => !o && setMenuFor(null)} title={menuFor?.title} actions={menuFor ? actionsFor(menuFor) : []} />
      <Dialog
        open={deleteFor !== null}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        title="Delete this listing?"
        description="It disappears from the Marketplace and from every chat where it was pinned. This can't be undone."
        icon={Trash2}
        tone="danger"
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteFor) await del.mutateAsync(deleteFor);
        }}
      />
    </Screen>
  );
};

/**
 * `/market/:id/edit`: the same ListingForm seeded from the listing (owner only — anyone else sees NotFound).
 * A price decrease notifies every saver (server); the pinned card in open chats re-resolves (`touchContext`).
 */
import { useMemo, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { ContentBlockedDetails, Id } from '@shared/core';
import { CATEGORY_LABELS } from '@shared/core';
import type { Listing } from '@shared/market';
import { Button, ErrorState, PageHeader, Screen, Skeleton, SkeletonText } from '@/ui';
import { NotFound } from '@/components';
import { errorMessage, isApiError } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { toast } from '@/lib/toast';
import { invalidateMarketLists, seedListingDetail, updateListingRequest, useListing, useMeetupPlaces } from './api';
import { MARKET_COPY } from './labels';
import { ListingForm, formFromListing, toRequest, validateForm } from './ListingForm';

export const EditListingPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const q = useListing(id);
  const places = useMeetupPlaces();
  useScreenView('listing_edit');
  if (q.isLoading || places.isLoading) {
    return (
      <Screen header={<PageHeader title="Edit listing" mode="compact" back />}>
        <div className="flex flex-col gap-4 px-4 py-4" aria-busy="true" aria-label="Loading listing">
          <Skeleton h={56} className="w-full rounded-lg" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton h="auto" className="aspect-square rounded-md" />
            <Skeleton h="auto" className="aspect-square rounded-md" />
            <Skeleton h="auto" className="aspect-square rounded-md" />
          </div>
          <SkeletonText lines={4} />
        </div>
      </Screen>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Screen header={<PageHeader title="Edit listing" mode="compact" back />}>
        <ErrorState title="Couldn't load this listing" error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    );
  }
  if (!q.data.viewer.isSelf) return <NotFound />;
  return <EditForm key={q.data.id} listing={q.data} presets={places.data?.items.map((p) => p.name) ?? []} />;
};

const EditForm: FC<{ listing: Listing; presets: string[] }> = ({ listing, presets }) => {
  const navigate = useNavigate();
  const initial = useMemo(() => formFromListing(listing, presets), [listing, presets]);
  const [value, setValue] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showProhibited, setShowProhibited] = useState(false);

  const save = useMutation({
    mutationFn: (id: Id) => updateListingRequest(id, toRequest(value)),
    onSuccess: (res) => {
      const { moderation, ...updated } = res;
      seedListingDetail(updated);
      invalidateMarketLists();
      showModerationNotice(moderation);
      if (moderation.status !== 'held') toast.success('Listing updated');
      navigate(routes.listing(updated.id), { replace: true });
    },
    onError: (e) => {
      if (handleModerationError(e)) {
        const category = isApiError(e) ? (e.details as Partial<ContentBlockedDetails> | undefined)?.category ?? null : null;
        if (category) {
          toast.info(MARKET_COPY.prohibited(CATEGORY_LABELS[category]), { action: { label: 'See the list', onClick: () => setShowProhibited(true) } });
        }
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const submit = () => {
    setAttempted(true);
    if (Object.keys(validateForm(value)).length > 0) {
      toast.error('A few fields need attention.');
      return;
    }
    save.mutate(listing.id);
  };

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate type-caption text-ink-3">{uploading ? 'Uploading photos…' : 'Savers hear about price drops'}</span>
      <Button variant="primary" loading={save.isPending} disabled={uploading} onClick={submit}>
        Save changes
      </Button>
    </div>
  );

  return (
    <Screen header={<PageHeader title="Edit listing" mode="compact" back />} footer={footer}>
      <ListingForm
        value={value}
        onChange={setValue}
        attempted={attempted}
        disabled={save.isPending}
        onUploadingChange={setUploading}
        showProhibited={showProhibited}
        onShowProhibitedChange={setShowProhibited}
      />
    </Screen>
  );
};

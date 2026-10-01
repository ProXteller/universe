/**
 * `/market/new` (`?type=wanted&title=` prefills the "Post a Wanted for {q}" path): compact header, the ListingForm,
 * CTA "Publish" in the footer. Success → detail; 422 → block sheet + the market's prohibited-item copy.
 */
import { useState, type FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import type { ContentBlockedDetails } from '@shared/core';
import { CATEGORY_LABELS } from '@shared/core';
import { Button, PageHeader, Screen } from '@/ui';
import { errorMessage, isApiError } from '@/lib/api';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { toast } from '@/lib/toast';
import { createListingRequest, invalidateMarketLists, seedListingDetail } from './api';
import { MARKET_COPY } from './labels';
import { ListingForm, emptyForm, toRequest, validateForm } from './ListingForm';

export const CreateListingPage: FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState(() => emptyForm({ type: params.get('type') ?? undefined, title: params.get('title') ?? undefined }));
  const [attempted, setAttempted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showProhibited, setShowProhibited] = useState(false);
  useScreenView('listing_create');

  const create = useMutation({
    mutationFn: () => createListingRequest(toRequest(value)),
    onSuccess: (res) => {
      const { moderation, ...listing } = res;
      seedListingDetail(listing);
      invalidateMarketLists();
      showModerationNotice(moderation);
      if (moderation.status !== 'held') toast.success('Listed on the Marketplace');
      navigate(routes.listing(listing.id), { replace: true });
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
    create.mutate();
  };

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate type-caption text-ink-3">{uploading ? 'Uploading photos…' : 'Live for 30 days on your campus'}</span>
      <Button variant="hero" loading={create.isPending} disabled={uploading} onClick={submit}>
        Publish
      </Button>
    </div>
  );

  return (
    <Screen header={<PageHeader title="New listing" mode="compact" back />} footer={footer}>
      <ListingForm
        value={value}
        onChange={setValue}
        attempted={attempted}
        disabled={create.isPending}
        onUploadingChange={setUploading}
        showProhibited={showProhibited}
        onShowProhibitedChange={setShowProhibited}
      />
    </Screen>
  );
};

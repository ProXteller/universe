/**
 * Make-offer sheet (product §2.8): amount input with the campus currency prefix, −10 % / −20 % / Asking chips,
 * "Send offer" → `POST /market/listings/:id/offers` → the chat. Works inside a pending request (the offer is exempt
 * from the one-message cap); a second pending offer is a 409 the seller has to answer first.
 */
import { useEffect, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { HandCoins } from 'lucide-react';
import type { Listing } from '@shared/market';
import { Button, Chip, Input, Sheet } from '@/ui';
import { errorMessage, isApiError } from '@/lib/api';
import { track } from '@/lib/analytics';
import { currencySymbol, formatPrice } from '@/lib/format';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { queryClient } from '@/lib/query';
import { toast } from '@/lib/toast';
import { marketKeys, offerRequest } from './api';

export interface OfferSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  listing: Listing;
}

export const OfferSheet: FC<OfferSheetProps> = ({ open, onOpenChange, listing }) => {
  const navigate = useNavigate();
  const asking = listing.price ?? 0;
  const [amount, setAmount] = useState(String(asking));
  useEffect(() => {
    if (open) setAmount(String(asking));
  }, [open, asking]);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && Number.isInteger(value);
  const presets = [
    { label: '−10%', value: Math.max(1, Math.round(asking * 0.9)) },
    { label: '−20%', value: Math.max(1, Math.round(asking * 0.8)) },
    { label: 'Asking', value: asking },
  ];

  const send = useMutation({
    mutationFn: () => offerRequest(listing.id, value),
    onSuccess: (res) => {
      queryClient.setQueryData<Listing>(marketKeys.listing(listing.id), (l) =>
        l ? { ...l, viewer: { ...l.viewer, hasConversation: true, conversationId: res.conversationId, hasPendingOffer: true } } : l,
      );
      toast.success(`Offer sent — ${formatPrice(value)}`);
      onOpenChange(false);
      navigate(routes.chat(res.conversationId));
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 409) {
        toast.error('You already have a pending offer. Wait for the seller to answer it.');
        onOpenChange(false);
        return;
      }
      if (isApiError(e, 'cannot_message')) {
        toast.error("You can't message this account.");
        return;
      }
      if (handleModerationError(e)) return;
      toast.error(errorMessage(e));
    },
  });

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate type-caption text-ink-3">Asking {formatPrice(asking)}</span>
      <Button variant="primary" leftIcon={HandCoins} loading={send.isPending} disabled={!valid} onClick={() => send.mutate()}>
        Send offer
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Make an offer" description={listing.title} detents={['auto']} footer={footer} dismissible={!send.isPending}>
      <div className="flex flex-col gap-4 px-4 pb-4">
        <Input
          label="Your offer"
          aria-label="Offer amount"
          prefix={currencySymbol()}
          inputMode="numeric"
          size="lg"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
          error={amount && !valid ? 'Enter a whole amount above zero.' : undefined}
          autoFocus
        />
        <div role="group" aria-label="Quick amounts" className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <Chip key={p.label} variant="choice" size="sm" selected={value === p.value} onClick={() => setAmount(String(p.value))}>
              {p.label} · {formatPrice(p.value)}
            </Chip>
          ))}
        </div>
        <p className="type-footnote text-ink-3">The seller can accept or decline in chat. Pay in person, never before you meet.</p>
      </div>
    </Sheet>
  );
};

/** Tap tracking for the offer entry point (the server tracks the sent offer). */
export function trackOfferOpen(listingId: string): void {
  track('listing_offer', { listing: listingId, step: 'open' });
}

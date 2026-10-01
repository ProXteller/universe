/**
 * Create / edit listing form (design §7.6): photos first (`MediaPicker grid`, "Make cover"), type chips, category,
 * title, price (sell / trade) + "for {tradeFor}" (trade), condition, course code (Textbooks), lost / found place + date,
 * description, meetup spot (campus presets + custom), the public `ComposerModeBanner verb="Listing"` and the
 * prohibited-items list. Client rules mirror the server (SPEC §5.8) so the first submit succeeds.
 */
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { ChevronDown } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { ListingCategory, ListingCondition, ListingType, UpsertListingRequest } from '@shared/market';
import {
  LISTING_CATEGORIES, LISTING_CONDITIONS, LISTING_CONDITION_LABELS, LISTING_TYPES, LISTING_TYPE_LABELS, PROHIBITED_ITEMS_COPY,
} from '@shared/market';
import { Button, ChipGroup, Input, Select, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaPicker } from '@/components';
import { cn } from '@/lib/cn';
import { currencySymbol, normalizeCourseCode } from '@/lib/format';
import { routes } from '@/lib/links';
import { useMeetupPlaces } from './api';

const CUSTOM = '__custom__';

export interface ListingFormValue {
  type: ListingType;
  category: ListingCategory | null;
  title: string;
  price: string;
  tradeFor: string;
  condition: ListingCondition | null;
  courseCode: string;
  meetup: string;
  customMeetup: string;
  locationText: string;
  occurredOn: string;
  description: string;
  photos: MediaImage[];
}

export function emptyForm(prefill?: { type?: string; title?: string }): ListingFormValue {
  const type = (LISTING_TYPES as readonly string[]).includes(prefill?.type ?? '') ? (prefill!.type as ListingType) : 'sell';
  return { type, category: null, title: prefill?.title ?? '', price: '', tradeFor: '', condition: 'good', courseCode: '', meetup: '', customMeetup: '', locationText: '', occurredOn: '', description: '', photos: [] };
}

export function formFromListing(l: { type: ListingType; category: ListingCategory; title: string; price: number | null; tradeFor: string | null; condition: ListingCondition | null; courseCode: string | null; meetupSpot: string | null; locationText: string | null; occurredOn: string | null; description: string; photos: MediaImage[] }, presets: string[]): ListingFormValue {
  const preset = l.meetupSpot && presets.includes(l.meetupSpot);
  return {
    type: l.type,
    category: l.category,
    title: l.title,
    price: l.price === null ? '' : String(l.price),
    tradeFor: l.tradeFor ?? '',
    condition: l.condition,
    courseCode: l.courseCode ?? '',
    meetup: l.meetupSpot ? (preset ? l.meetupSpot : CUSTOM) : '',
    customMeetup: l.meetupSpot && !preset ? l.meetupSpot : '',
    locationText: l.locationText ?? '',
    occurredOn: l.occurredOn ?? '',
    description: l.description,
    photos: l.photos,
  };
}

export interface FormErrors {
  title?: string;
  category?: string;
  price?: string;
  tradeFor?: string;
  courseCode?: string;
  occurredOn?: string;
}

export function validateForm(v: ListingFormValue): FormErrors {
  const e: FormErrors = {};
  const priceN = v.price.trim() ? Number(v.price) : null;
  if (!v.title.trim()) e.title = 'Give it a title.';
  else if (v.title.trim().length > LIMITS.listingTitle) e.title = `Keep it under ${LIMITS.listingTitle} characters.`;
  if (!v.category) e.category = 'Pick a category.';
  if (v.type === 'sell' && (priceN === null || !Number.isFinite(priceN) || priceN <= 0)) e.price = 'Add a price to sell this.';
  if (v.type === 'trade' && priceN !== null && (!Number.isFinite(priceN) || priceN <= 0)) e.price = 'A trade price must be above zero, or leave it out.';
  if (v.type === 'trade' && !v.tradeFor.trim()) e.tradeFor = 'Say what you want to trade for.';
  else if (v.tradeFor.trim().length > LIMITS.listingTradeFor) e.tradeFor = `Keep "trade for" under ${LIMITS.listingTradeFor} characters.`;
  if (v.category === 'textbooks' && v.courseCode.trim() && !normalizeCourseCode(v.courseCode)) e.courseCode = 'Try a code like "CS 314".';
  if ((v.type === 'lost' || v.type === 'found') && v.occurredOn && !/^\d{4}-\d{2}-\d{2}$/.test(v.occurredOn)) e.occurredOn = 'Pick a date.';
  return e;
}

export function toRequest(v: ListingFormValue): UpsertListingRequest {
  const lostFound = v.type === 'lost' || v.type === 'found';
  const priced = v.type === 'sell' || v.type === 'trade';
  const showCondition = !(v.type === 'wanted' || lostFound);
  return {
    type: v.type,
    category: v.category ?? 'other',
    title: v.title.trim(),
    description: v.description.trim(),
    price: priced && v.price.trim() ? Math.round(Number(v.price)) : null,
    tradeFor: v.type === 'trade' ? v.tradeFor.trim() : null,
    condition: showCondition ? v.condition : null,
    courseCode: v.category === 'textbooks' && v.courseCode.trim() ? (normalizeCourseCode(v.courseCode) ?? v.courseCode.trim()) : null,
    meetupSpot: lostFound ? null : v.meetup === CUSTOM ? v.customMeetup.trim() || null : v.meetup || null,
    locationText: lostFound ? v.locationText.trim() || null : null,
    occurredOn: lostFound ? v.occurredOn || null : null,
    photos: v.photos,
  };
}

export interface ListingFormProps {
  value: ListingFormValue;
  onChange(next: ListingFormValue): void;
  /** Errors are shown only after the first submit attempt. */
  attempted: boolean;
  disabled?: boolean;
  onUploadingChange(busy: boolean): void;
  /** Opens the prohibited-items list (after a 422 from the server). */
  showProhibited: boolean;
  onShowProhibitedChange(open: boolean): void;
}

const TYPE_OPTIONS = LISTING_TYPES.map((t) => ({ value: t, label: LISTING_TYPE_LABELS[t] }));
const CATEGORY_OPTIONS = LISTING_CATEGORIES.map((c) => ({ value: c.id, label: c.label }));
const CONDITION_OPTIONS = LISTING_CONDITIONS.map((c) => ({ value: c, label: LISTING_CONDITION_LABELS[c] }));

export const ListingForm: FC<ListingFormProps> = ({ value: v, onChange, attempted, disabled = false, onUploadingChange, showProhibited, onShowProhibitedChange }) => {
  const places = useMeetupPlaces();
  const presets = useMemo(() => places.data?.items.map((p) => p.name) ?? [], [places.data]);
  const errors = attempted ? validateForm(v) : {};
  const lostFound = v.type === 'lost' || v.type === 'found';
  const priced = v.type === 'sell' || v.type === 'trade';
  const showCondition = !(v.type === 'wanted' || lostFound);
  const prohibitedRef = useRef<HTMLDivElement | null>(null);
  const set = (patch: Partial<ListingFormValue>) => onChange({ ...v, ...patch });

  useEffect(() => {
    if (showProhibited) prohibitedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [showProhibited]);

  const meetupOptions = useMemo(
    () => [...presets.map((p) => ({ value: p, label: p })), { value: CUSTOM, label: 'Somewhere else…', description: 'Type your own public spot' }],
    [presets],
  );

  return (
    <ComposerGuard scope="public">
      <div className="flex flex-col gap-5 px-4 pb-4 pt-2">
        <ComposerModeBanner mode="public" verb="Listing" note="Buyers see your public profile and campus" />

        <section className="flex flex-col gap-2">
          <h2 className="type-overline text-ink-3">Photos</h2>
          <MediaPicker
            value={v.photos}
            onChange={(photos) => set({ photos })}
            max={LIMITS.listingPhotos}
            variant="grid"
            coverLabel
            disabled={disabled}
            onUploadingChange={onUploadingChange}
            hint={v.type === 'wanted' ? 'Optional for a Wanted post' : `Photos first — up to ${LIMITS.listingPhotos}, the first one is your cover`}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="type-overline text-ink-3">Type</h2>
          <ChipGroup<ListingType> aria-label="Listing type" options={TYPE_OPTIONS} value={v.type} onChange={(t: ListingType) => set({ type: t })} scroll="x" size="md" />
        </section>

        <Select<ListingCategory>
          label="Category"
          placeholder="Pick a category"
          value={v.category}
          onChange={(category) => set({ category })}
          options={CATEGORY_OPTIONS}
          error={errors.category}
          disabled={disabled}
        />

        <Input
          label="Title"
          placeholder={v.type === 'wanted' ? 'What are you looking for?' : v.type === 'lost' ? 'What did you lose?' : v.type === 'found' ? 'What did you find?' : 'What are you selling?'}
          value={v.title}
          maxLength={LIMITS.listingTitle}
          onChange={(e) => set({ title: e.target.value })}
          error={errors.title}
          disabled={disabled}
        />

        {priced ? (
          <Input
            label={v.type === 'trade' ? 'Or a price (optional)' : 'Price'}
            prefix={currencySymbol()}
            inputMode="numeric"
            placeholder="0"
            value={v.price}
            onChange={(e) => set({ price: e.target.value.replace(/[^\d]/g, '') })}
            helper={v.type === 'trade' ? 'Shown as "or {price}" next to your trade' : undefined}
            error={errors.price}
            disabled={disabled}
          />
        ) : null}

        {v.type === 'trade' ? (
          <Input
            label="Trade for"
            placeholder="a desk fan"
            prefix="for"
            value={v.tradeFor}
            maxLength={LIMITS.listingTradeFor}
            onChange={(e) => set({ tradeFor: e.target.value })}
            helper="Buyers see “Trade · for {this}” and can propose a trade"
            error={errors.tradeFor}
            disabled={disabled}
          />
        ) : null}

        {showCondition ? (
          <section className="flex flex-col gap-2">
            <h2 className="type-overline text-ink-3">Condition</h2>
            <ChipGroup<ListingCondition> aria-label="Condition" options={CONDITION_OPTIONS} value={v.condition} onChange={(c: ListingCondition) => set({ condition: c })} scroll="wrap" size="md" />
          </section>
        ) : null}

        {v.category === 'textbooks' ? (
          <Input
            label="Course code (optional)"
            placeholder="CS 314"
            value={v.courseCode}
            onChange={(e) => set({ courseCode: e.target.value })}
            onBlur={() => {
              const n = normalizeCourseCode(v.courseCode);
              if (n) set({ courseCode: n });
            }}
            helper="Adds a “Textbooks for {code}” link from that course chat"
            error={errors.courseCode}
            disabled={disabled}
          />
        ) : null}

        {lostFound ? (
          <>
            <Input
              label={v.type === 'lost' ? 'Where did you last have it?' : 'Where did you find it?'}
              placeholder="Near the library bike racks"
              value={v.locationText}
              maxLength={120}
              onChange={(e) => set({ locationText: e.target.value })}
              disabled={disabled}
            />
            <Input label="When (optional)" type="date" value={v.occurredOn} onChange={(e) => set({ occurredOn: e.target.value })} error={errors.occurredOn} disabled={disabled} />
          </>
        ) : null}

        <Textarea
          label="Description"
          placeholder={v.type === 'found' ? 'Describe it loosely — ask the owner to prove it’s theirs.' : 'Condition details, what’s included, why you’re parting with it.'}
          minRows={3}
          maxRows={10}
          maxLength={LIMITS.listingDescription}
          showCount
          value={v.description}
          onChange={(e) => set({ description: e.target.value })}
          disabled={disabled}
        />

        {!lostFound ? (
          <>
            <Select<string>
              label="Meetup spot"
              placeholder={places.isLoading ? 'Loading campus spots…' : 'Pick a public spot on campus'}
              value={v.meetup || null}
              onChange={(meetup) => set({ meetup })}
              options={meetupOptions}
              disabled={disabled || places.isLoading}
            />
            {v.meetup === CUSTOM ? (
              <Input label="Your spot" placeholder="A public place on campus" value={v.customMeetup} maxLength={80} onChange={(e) => set({ customMeetup: e.target.value })} disabled={disabled} />
            ) : null}
          </>
        ) : null}

        <div ref={prohibitedRef} className={cn('rounded-lg border bg-surface-1', showProhibited ? 'border-warning/45' : 'border-line')}>
          <button
            type="button"
            aria-expanded={showProhibited}
            onClick={() => onShowProhibitedChange(!showProhibited)}
            className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 text-left"
          >
            <span className="type-label-sm text-ink">What can’t be listed</span>
            <ChevronDown size={18} strokeWidth={1.75} aria-hidden className={cn('text-ink-3 transition-transform', showProhibited && 'rotate-180')} />
          </button>
          {showProhibited ? (
            <div className="flex flex-col gap-2 px-3.5 pb-3.5">
              <ul className="flex flex-col gap-1 pl-5">
                {PROHIBITED_ITEMS_COPY.map((p) => (
                  <li key={p} className="list-disc type-footnote text-ink-2">
                    {p}
                  </li>
                ))}
              </ul>
              <Button variant="ghost" size="sm" to={routes.guidelines('#drugs')} className="self-start">
                Read the guidelines
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </ComposerGuard>
  );
};

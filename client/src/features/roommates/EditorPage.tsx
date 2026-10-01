/**
 * The roommate editor — one question per step (one tap each, auto-advance), two dealbreakers, then for
 * "Post that I'm looking": basics → place (has-a-place) → about → review with the public `ComposerModeBanner`
 * ("Posting as @handle · Your post links to your public profile") and Publish. "Just browse & match" ends after the
 * dealbreakers with a private review (nothing is posted). `?intent=post|match`, `?step=` deep links from My profile.
 */
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Check, Home, Plus, Search } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { LIMITS } from '@shared/core';
import {
  QUESTION_DEFS, ROOMMATE_LIMITS, ROOMMATE_MODE_LABEL, ROOMMATE_PHOTO_HINT, ROOMMATE_QUESTIONS,
  type LivingWith, type MyRoommateProfile, type RoommateAnswer, type RoommateAnswers, type RoommateGender, type RoommateMode, type RoommateQuestion,
  type UpsertRoommateProfileRequest,
} from '@shared/roommates';
import { Button, Chip, ChipGroup, ErrorState, Input, ListRow, NumberStepper, PageHeader, Screen, SegmentedControl, Select, Skeleton, StepDots, Switch, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaPicker } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage, isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { currencySymbol, formatPrice } from '@/lib/format';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { useFadeUp } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useMyProfile, useNeighborhoods, useUpsertProfile } from './api';
import { formatMoveIn, LIVING_WITH_LABEL, upcomingMonths } from './filters';

type Intent = 'post' | 'match';
type StepKind = 'q' | 'dealbreakers' | 'basics' | 'place' | 'about' | 'review';
interface Step {
  kind: StepKind;
  q?: RoommateQuestion;
  title: string;
}

interface PlaceDraft {
  rent: string;
  roomType: 'private' | 'shared';
  beds: number;
  baths: number;
  furnished: boolean;
  utilitiesIncluded: boolean;
}

interface Draft {
  answers: Partial<RoommateAnswers>;
  dealbreakSmoking: boolean;
  dealbreakPets: boolean;
  mode: RoommateMode | null;
  budget: string;
  moveIn: string | null;
  lease: string;
  neighborhoods: string[];
  livingWith: LivingWith;
  gender: RoommateGender | null;
  about: string;
  photos: MediaImage[];
  place: PlaceDraft;
}

const LEASE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'flex', label: 'Flexible' },
  { value: '3', label: '3 months' },
  { value: '6', label: '6 months' },
  { value: '9', label: '9 months' },
  { value: '12', label: '12 months' },
  { value: '18', label: '18 months' },
  { value: '24', label: '24 months' },
];

const GENDER_OPTIONS: readonly { value: RoommateGender; label: string }[] = [
  { value: 'woman', label: 'Woman' },
  { value: 'man', label: 'Man' },
  { value: 'nonbinary', label: 'Non-binary' },
];

const MODE_OPTIONS: readonly { value: RoommateMode; label: string; icon: typeof Home }[] = [
  { value: 'need', label: 'I need a place', icon: Search },
  { value: 'have', label: 'I have a place', icon: Home },
];

function draftFrom(p: MyRoommateProfile | null): Draft {
  return {
    answers: p ? { ...p.answers } : {},
    dealbreakSmoking: p?.dealbreakSmoking ?? false,
    dealbreakPets: p?.dealbreakPets ?? false,
    mode: p?.mode ?? null,
    budget: p?.budget !== null && p?.budget !== undefined ? String(p.budget) : '',
    moveIn: p?.moveIn ?? null,
    lease: p?.leaseMonths ? String(p.leaseMonths) : 'flex',
    neighborhoods: p?.neighborhoods ?? [],
    livingWith: p?.livingWith ?? 'anyone',
    gender: p?.gender ?? null,
    about: p?.about ?? '',
    photos: p?.photos ?? [],
    place: {
      rent: p?.place ? String(p.place.rent) : '',
      roomType: p?.place?.roomType ?? 'private',
      beds: p?.place?.beds ?? 2,
      baths: p?.place?.baths ?? 1,
      furnished: p?.place?.furnished ?? false,
      utilitiesIncluded: p?.place?.utilitiesIncluded ?? false,
    },
  };
}

function stepsFor(intent: Intent, mode: RoommateMode | null): Step[] {
  const qs: Step[] = ROOMMATE_QUESTIONS.map((q) => ({ kind: 'q', q, title: 'How you live' }));
  const base: Step[] = [...qs, { kind: 'dealbreakers', title: 'Dealbreakers' }];
  if (intent === 'match') return [...base, { kind: 'review', title: 'Review' }];
  return [...base, { kind: 'basics', title: 'Basics' }, ...(mode === 'have' ? [{ kind: 'place', title: 'Your place' } as Step] : []), { kind: 'about', title: 'About you' }, { kind: 'review', title: 'Review' }];
}

const allAnswered = (a: Partial<RoommateAnswers>): a is RoommateAnswers => ROOMMATE_QUESTIONS.every((q) => a[q] !== undefined);

type BasicsField = 'mode' | 'budget' | 'moveIn' | 'neighborhoods' | 'gender';

function basicsErrors(d: Draft): Partial<Record<BasicsField, string>> {
  const e: Partial<Record<BasicsField, string>> = {};
  if (!d.mode) e.mode = 'Pick one.';
  const budget = Number(d.budget);
  if (!d.budget.trim() || !Number.isInteger(budget) || budget < ROOMMATE_LIMITS.budgetMin || budget > ROOMMATE_LIMITS.budgetMax) e.budget = `Enter a monthly amount between ${ROOMMATE_LIMITS.budgetMin} and ${ROOMMATE_LIMITS.budgetMax}.`;
  if (!d.moveIn) e.moveIn = 'Pick a month.';
  if (d.neighborhoods.length === 0) e.neighborhoods = 'Add at least one area.';
  if (d.livingWith === 'same_gender' && !d.gender) e.gender = 'Needed to match same-gender posts.';
  return e;
}

function placeErrors(d: Draft): { rent?: string } {
  const rent = Number(d.place.rent);
  if (!d.place.rent.trim() || !Number.isInteger(rent) || rent <= 0) return { rent: 'Enter the monthly rent for the room.' };
  return {};
}

/* ------------------------------------------------------------------ option row */

const OptionRow: FC<{ label: string; tag: string; selected: boolean; onClick(): void }> = ({ label, tag, selected, onClick }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onClick}
    className={cn(
      'press flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors',
      selected ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface-1 text-ink hover:border-line-strong',
    )}
  >
    <span className="flex min-w-0 flex-col">
      <span className="type-body">{label}</span>
      <span className="type-caption text-ink-3">{tag}</span>
    </span>
    <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border', selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong')} aria-hidden>
      {selected ? <Check size={14} strokeWidth={2.5} /> : null}
    </span>
  </button>
);

/* ------------------------------------------------------------------ page */

export const EditorPage: FC = () => {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const profileQuery = useMyProfile();
  const hoods = useNeighborhoods();
  const upsert = useUpsertProfile();
  const fade = useFadeUp();

  const canPublish = me.isAdult === true;
  const requested = params.get('intent');
  const profile = profileQuery.data?.profile ?? null;
  const intent: Intent = requested === 'post' ? (canPublish ? 'post' : 'match') : requested === 'match' ? 'match' : profile?.published ? 'post' : 'match';
  useScreenView('roommates_editor', { intent });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [touched, setTouched] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [custom, setCustom] = useState('');
  const advanceTimer = useRef<number | null>(null);

  const steps = useMemo(() => stepsFor(intent, draft?.mode ?? null), [intent, draft?.mode]);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;

  // Prefill once the profile has loaded; deep links choose the starting step, editing starts on the review.
  useEffect(() => {
    if (!profileQuery.isSuccess || draft !== null) return;
    const d = draftFrom(profile);
    setDraft(d);
    const list = stepsFor(intent, d.mode);
    const want = params.get('step');
    const wantKind: StepKind | null = want === 'questions' ? 'q' : want === 'dealbreakers' || want === 'basics' || want === 'place' || want === 'about' || want === 'review' ? want : null;
    const idx = wantKind ? list.findIndex((s) => s.kind === wantKind) : -1;
    const basicsIdx = list.findIndex((s) => s.kind === 'basics');
    const placeIdx = list.findIndex((s) => s.kind === 'place');
    if (idx >= 0) setStepIndex(idx);
    // "Post it" on a browse-&-match row: land on what is missing, not on a review whose Publish is disabled.
    else if (profile && intent === 'post' && basicsIdx >= 0 && Object.keys(basicsErrors(d)).length > 0) setStepIndex(basicsIdx);
    else if (profile && intent === 'post' && placeIdx >= 0 && Object.keys(placeErrors(d)).length > 0) setStepIndex(placeIdx);
    else if (profile) setStepIndex(list.length - 1);
    else setStepIndex(0);
  }, [profileQuery.isSuccess, profile, draft, intent, params]);

  useEffect(
    () => () => {
      if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    },
    [],
  );

  const patch = (p: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...p } : d));
  const goTo = (i: number): void => {
    setTouched(false);
    setStepIndex(Math.max(0, Math.min(steps.length - 1, i)));
  };
  const jumpTo = (kind: StepKind): void => {
    const i = steps.findIndex((s) => s.kind === kind);
    if (i >= 0) goTo(i);
  };

  const choose = (q: RoommateQuestion, v: RoommateAnswer): void => {
    setDraft((d) => (d ? { ...d, answers: { ...d.answers, [q]: v } } : d));
    if (advanceTimer.current !== null) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(() => goTo(stepIndex + 1), 160);
  };

  const errors = draft ? basicsErrors(draft) : {};
  const pErrors = draft ? placeErrors(draft) : {};

  const canNext = (): boolean => {
    if (!draft) return false;
    switch (step.kind) {
      case 'q':
        return draft.answers[step.q!] !== undefined;
      case 'basics':
        return Object.keys(errors).length === 0;
      case 'place':
        return Object.keys(pErrors).length === 0 && !uploading;
      case 'about':
        return !uploading;
      case 'review':
        return allAnswered(draft.answers) && (intent === 'match' || (Object.keys(errors).length === 0 && (draft.mode !== 'have' || Object.keys(pErrors).length === 0))) && !uploading && !upsert.isPending;
      default:
        return true;
    }
  };

  const submit = (): void => {
    if (!draft || !allAnswered(draft.answers)) {
      const first = ROOMMATE_QUESTIONS.findIndex((q) => draft?.answers[q] === undefined);
      goTo(Math.max(0, first));
      return;
    }
    // PUT /me is a full replace: send the basics whenever the row has them (posted now, or unpublished and kept by the
    // server) so a "match"-intent edit of the answers does not wipe a post the user may re-publish later.
    const includeBasics = intent === 'post' || Boolean(profile?.published) || profile?.mode != null;
    const body: UpsertRoommateProfileRequest = {
      answers: draft.answers,
      dealbreakSmoking: draft.dealbreakSmoking,
      dealbreakPets: draft.dealbreakPets,
      publish: intent === 'post',
      gender: draft.gender,
      ...(includeBasics
        ? {
            mode: draft.mode,
            budget: draft.budget.trim() ? Number(draft.budget) : null,
            moveIn: draft.moveIn,
            leaseMonths: draft.lease === 'flex' ? null : Number(draft.lease),
            neighborhoods: draft.neighborhoods,
            livingWith: draft.livingWith,
            about: draft.about.trim(),
            photos: draft.mode === 'have' ? draft.photos : [],
            place:
              draft.mode === 'have'
                ? { rent: Number(draft.place.rent), roomType: draft.place.roomType, beds: draft.place.beds, baths: draft.place.baths, furnished: draft.place.furnished, utilitiesIncluded: draft.place.utilitiesIncluded }
                : null,
          }
        : {}),
    };
    upsert.mutate(body, {
      onSuccess: (res) => {
        showModerationNotice(res.moderation);
        if (intent === 'post') {
          toast.success(res.status === 'held' ? (profile?.published ? 'Changes saved — still in review' : 'Post submitted — in review') : profile?.published ? 'Post updated' : 'Your post is live');
          navigate(routes.roommatesMe(), { replace: true });
        } else {
          toast.success('Answers saved — Browse is now ranked for you');
          navigate(routes.roommates(), { replace: true });
        }
      },
      onError: (e) => {
        if (handleModerationError(e, { onEdit: () => jumpTo('about') })) return;
        if (isApiError(e) && e.status === 400 && intent === 'post') {
          jumpTo('basics');
          setTouched(true);
        }
        toast.error(errorMessage(e));
      },
    });
  };

  const next = (): void => {
    if (step.kind === 'review') {
      submit();
      return;
    }
    if ((step.kind === 'basics' || step.kind === 'place') && !canNext()) {
      setTouched(true);
      return;
    }
    goTo(stepIndex + 1);
  };

  /* ---------------------------------------------------------------- render */

  const header = (
    <PageHeader
      mode="compact"
      back={() => (stepIndex > 0 ? goTo(stepIndex - 1) : navigate(routes.roommatesMe()))}
      title={step.title}
      below={
        <div className="flex justify-center bg-canvas pb-2">
          <StepDots total={steps.length} current={stepIndex + 1} label />
        </div>
      }
    />
  );

  let content;
  if (profileQuery.isError) {
    content = <ErrorState error={profileQuery.error} onRetry={() => void profileQuery.refetch()} />;
  } else if (!draft) {
    content = (
      <div className="flex flex-col gap-4 px-4 pt-4">
        <Skeleton w="80%" h={28} />
        <Skeleton w="50%" h={14} />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} w="100%" h={56} className="rounded-lg" />
        ))}
      </div>
    );
  } else if (step.kind === 'q') {
    const q = step.q!;
    const def = QUESTION_DEFS[q];
    content = (
      <div className="flex flex-col gap-6 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">{def.title}</h2>
          <p className="type-body text-ink-2">{def.hint}</p>
        </div>
        <div role="radiogroup" aria-label={def.title} className="flex flex-col gap-2">
          {def.options.map((opt, i) => (
            <OptionRow key={opt} label={opt} tag={def.tags[i as 0 | 1 | 2 | 3]} selected={draft.answers[q] === i} onClick={() => choose(q, i as RoommateAnswer)} />
          ))}
        </div>
      </div>
    );
  } else if (step.kind === 'dealbreakers') {
    content = (
      <div className="flex flex-col gap-6 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">Any dealbreakers?</h2>
          <p className="type-body text-ink-2">A conflict caps a match at 35%, in both directions.</p>
        </div>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <ListRow
            title="No smokers or vapers"
            subtitle="Caps anyone who smokes outside or regularly."
            trailing={<Switch checked={draft.dealbreakSmoking} onChange={(v) => patch({ dealbreakSmoking: v })} aria-label="No smokers or vapers" />}
          />
          <ListRow title="No pets" subtitle="Caps anyone who has a pet." trailing={<Switch checked={draft.dealbreakPets} onChange={(v) => patch({ dealbreakPets: v })} aria-label="No pets" />} />
        </div>
        {intent === 'match' ? (
          <Select<RoommateGender>
            label="Your gender (optional)"
            value={draft.gender}
            onChange={(v) => patch({ gender: v })}
            options={GENDER_OPTIONS}
            placeholder="Prefer not to say"
            sheetTitle="Your gender"
          />
        ) : null}
        {intent === 'match' ? <p className="type-footnote text-ink-3">Only used to show you posts marked "same gender only". Never shown to anyone.</p> : null}
      </div>
    );
  } else if (step.kind === 'basics') {
    const presets = Array.from(new Set([...(hoods.data ?? []), ...draft.neighborhoods]));
    const addCustom = (): void => {
      const name = custom.trim().slice(0, ROOMMATE_LIMITS.neighborhoodNameMax);
      if (!name || draft.neighborhoods.length >= ROOMMATE_LIMITS.neighborhoodsMax) return;
      if (!draft.neighborhoods.includes(name)) patch({ neighborhoods: [...draft.neighborhoods, name] });
      setCustom('');
    };
    content = (
      <div className="flex flex-col gap-6 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">The basics</h2>
          <p className="type-body text-ink-2">What people see first on your card.</p>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="type-label-sm text-ink-2">Looking to</span>
          <SegmentedControl<RoommateMode> value={draft.mode ?? 'need'} onChange={(v) => patch({ mode: v })} options={MODE_OPTIONS} fullWidth aria-label="Mode" />
          {touched && errors.mode ? <span className="type-caption text-danger">{errors.mode}</span> : null}
        </div>
        <Input
          label="Monthly budget (your share)"
          type="number"
          inputMode="numeric"
          min={ROOMMATE_LIMITS.budgetMin}
          max={ROOMMATE_LIMITS.budgetMax}
          step={25}
          prefix={currencySymbol(me.currency)}
          value={draft.budget}
          onChange={(e) => patch({ budget: e.target.value })}
          error={touched ? errors.budget : undefined}
          helper={draft.budget && !errors.budget ? `${formatPrice(Number(draft.budget), me.currency)} a month` : undefined}
        />
        <Select<string>
          label="Move-in month"
          value={draft.moveIn}
          onChange={(v) => patch({ moveIn: v })}
          options={upcomingMonths(18)}
          placeholder="Pick a month"
          error={touched ? errors.moveIn : undefined}
          sheetTitle="Move-in month"
        />
        <Select<string> label="Lease length" value={draft.lease} onChange={(v) => patch({ lease: v })} options={LEASE_OPTIONS} sheetTitle="Lease length" />
        <div className="flex flex-col gap-2">
          <span className="type-label-sm text-ink-2">Neighborhoods ({draft.neighborhoods.length}/{ROOMMATE_LIMITS.neighborhoodsMax})</span>
          {presets.length ? (
            <ChipGroup<string>
              options={presets.map((n) => ({ value: n, label: n }))}
              value={draft.neighborhoods}
              onChange={(v: string[]) => patch({ neighborhoods: v })}
              multiple
              max={ROOMMATE_LIMITS.neighborhoodsMax}
              scroll="wrap"
              aria-label="Neighborhoods"
            />
          ) : null}
          <div className="flex items-end gap-2">
            <Input
              label="Add an area"
              placeholder="e.g. East Riverside"
              value={custom}
              maxLength={ROOMMATE_LIMITS.neighborhoodNameMax}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addCustom();
                }
              }}
              className="flex-1"
            />
            <Button variant="secondary" leftIcon={Plus} onClick={addCustom} disabled={!custom.trim() || draft.neighborhoods.length >= ROOMMATE_LIMITS.neighborhoodsMax}>
              Add
            </Button>
          </div>
          {touched && errors.neighborhoods ? <span className="type-caption text-danger">{errors.neighborhoods}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="type-label-sm text-ink-2">Comfortable living with</span>
          <SegmentedControl<LivingWith>
            value={draft.livingWith}
            onChange={(v) => patch({ livingWith: v })}
            options={[
              { value: 'anyone', label: LIVING_WITH_LABEL.anyone },
              { value: 'same_gender', label: LIVING_WITH_LABEL.same_gender },
            ]}
            fullWidth
            aria-label="Comfortable living with"
          />
        </div>
        {draft.livingWith === 'same_gender' ? (
          <Select<RoommateGender>
            label="Your gender"
            value={draft.gender}
            onChange={(v) => patch({ gender: v })}
            options={GENDER_OPTIONS}
            placeholder="Pick one"
            error={touched ? errors.gender : undefined}
            sheetTitle="Your gender"
          />
        ) : null}
      </div>
    );
  } else if (step.kind === 'place') {
    content = (
      <div className="flex flex-col gap-6 px-4 pt-4">
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">Your place</h2>
          <p className="type-body text-ink-2">Neighborhood or building name only — never a street address.</p>
        </div>
        <Input
          label="Rent for the room"
          type="number"
          inputMode="numeric"
          min={1}
          step={25}
          prefix={currencySymbol(me.currency)}
          value={draft.place.rent}
          onChange={(e) => patch({ place: { ...draft.place, rent: e.target.value } })}
          error={touched ? pErrors.rent : undefined}
        />
        <div className="flex flex-col gap-1.5">
          <span className="type-label-sm text-ink-2">Room</span>
          <SegmentedControl<'private' | 'shared'>
            value={draft.place.roomType}
            onChange={(v) => patch({ place: { ...draft.place, roomType: v } })}
            options={[
              { value: 'private', label: 'Private room' },
              { value: 'shared', label: 'Shared room' },
            ]}
            fullWidth
            aria-label="Room type"
          />
        </div>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <ListRow title="Bedrooms" trailing={<NumberStepper value={draft.place.beds} min={1} max={ROOMMATE_LIMITS.bedsMax} onChange={(v) => patch({ place: { ...draft.place, beds: v } })} aria-label="Bedrooms" />} />
          <ListRow title="Bathrooms" trailing={<NumberStepper value={draft.place.baths} min={1} max={ROOMMATE_LIMITS.bathsMax} onChange={(v) => patch({ place: { ...draft.place, baths: v } })} aria-label="Bathrooms" />} />
          <ListRow title="Furnished" trailing={<Switch checked={draft.place.furnished} onChange={(v) => patch({ place: { ...draft.place, furnished: v } })} aria-label="Furnished" />} />
          <ListRow title="Utilities included" trailing={<Switch checked={draft.place.utilitiesIncluded} onChange={(v) => patch({ place: { ...draft.place, utilitiesIncluded: v } })} aria-label="Utilities included" />} />
        </div>
        <div className="flex flex-col gap-2">
          <span className="type-label-sm text-ink-2">Photos</span>
          <MediaPicker value={draft.photos} onChange={(v) => patch({ photos: v })} max={LIMITS.roommatePhotos} coverLabel hint={ROOMMATE_PHOTO_HINT} onUploadingChange={setUploading} />
        </div>
      </div>
    );
  } else if (step.kind === 'about') {
    content = (
      <div className="flex flex-col gap-5 px-4 pt-4">
        <ComposerModeBanner mode="public" verb="Posting" note={`Your post links to your public profile @${me.handle}`} />
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">About you</h2>
          <p className="type-body text-ink-2">A few lines in your own voice. Only your first name is shown on the card.</p>
        </div>
        <Textarea
          label="About"
          value={draft.about}
          onChange={(e) => patch({ about: e.target.value })}
          maxLength={LIMITS.roommateAbout}
          showCount
          minRows={5}
          helper="Neighborhood or building name only — no street addresses or room numbers. Lifestyle preferences are welcome; excluding people isn't."
        />
      </div>
    );
  } else {
    const tags = allAnswered(draft.answers) ? ROOMMATE_QUESTIONS.slice(0, 3).map((q) => QUESTION_DEFS[q].tags[draft.answers[q] as 0 | 1 | 2 | 3]) : [];
    const answered = ROOMMATE_QUESTIONS.filter((q) => draft.answers[q] !== undefined).length;
    content = (
      <div className="flex flex-col gap-5 px-4 pt-4">
        {intent === 'post' ? (
          <ComposerModeBanner mode="public" verb="Posting" note={`Your post links to your public profile @${me.handle}`} />
        ) : (
          <ComposerModeBanner mode="public" verb="Saving" note="Private — only you can see your answers. Nothing is posted." />
        )}
        <div className="flex flex-col gap-1">
          <h2 className="type-title-1">{intent === 'post' ? (profile?.published ? 'Review your post' : 'Ready to post?') : 'Ready to match'}</h2>
          <p className="type-body text-ink-2">
            {intent === 'post' ? `People at ${me.university.shortName} will see your card in Browse, ranked by how well you'd live together.` : 'Browse gets ranked by your match % with everyone. Nobody sees your answers.'}
          </p>
        </div>
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <ListRow
            title="How you live"
            subtitle={
              answered === ROOMMATE_QUESTIONS.length ? (
                <span className="flex flex-wrap gap-1.5 pt-1">
                  {tags.map((t) => (
                    <Chip key={t} variant="tag" size="sm">
                      {t}
                    </Chip>
                  ))}
                </span>
              ) : (
                `${answered} of ${ROOMMATE_QUESTIONS.length} answered`
              )
            }
            trailing="chevron"
            onClick={() => jumpTo('q')}
          />
          <ListRow title="Dealbreakers" subtitle={[draft.dealbreakSmoking ? 'No smokers' : null, draft.dealbreakPets ? 'No pets' : null].filter(Boolean).join(' · ') || 'None'} trailing="chevron" onClick={() => jumpTo('dealbreakers')} />
          {intent === 'post' ? (
            <>
              <ListRow
                title="Basics"
                subtitle={
                  Object.keys(errors).length
                    ? 'Something is missing'
                    : [draft.mode ? ROOMMATE_MODE_LABEL[draft.mode] : null, `${formatPrice(Number(draft.budget), me.currency)}/mo`, formatMoveIn(draft.moveIn), draft.neighborhoods.join(', ')].filter(Boolean).join(' · ')
                }
                trailing="chevron"
                onClick={() => jumpTo('basics')}
              />
              {draft.mode === 'have' ? (
                <ListRow
                  title="Your place"
                  subtitle={pErrors.rent ? 'Add the rent' : `${formatPrice(Number(draft.place.rent), me.currency)}/mo · ${draft.place.roomType === 'private' ? 'Private room' : 'Shared room'} · ${draft.photos.length} photos`}
                  trailing="chevron"
                  onClick={() => jumpTo('place')}
                />
              ) : null}
              <ListRow title="About you" subtitle={draft.about.trim() || 'Nothing yet'} trailing="chevron" onClick={() => jumpTo('about')} />
            </>
          ) : null}
        </div>
        {intent === 'post' && !profile?.published ? <p className="type-footnote text-ink-3">You can pause or unpublish anytime from My profile. Posts pause on their own after 60 days without a "still looking" confirmation.</p> : null}
      </div>
    );
  }

  const nextLabel = step.kind === 'review' ? (intent === 'post' ? (profile?.published ? 'Save changes' : 'Publish') : 'Save answers') : 'Next';

  const footer = draft ? (
    <div className="flex items-center gap-2 px-4 py-3">
      <Button variant="ghost" onClick={() => (stepIndex > 0 ? goTo(stepIndex - 1) : navigate(routes.roommatesMe()))}>
        {stepIndex > 0 ? 'Back' : 'Cancel'}
      </Button>
      <Button fullWidth variant={step.kind === 'review' && intent === 'post' ? 'hero' : 'primary'} disabled={!canNext()} loading={upsert.isPending} onClick={next}>
        {nextLabel}
      </Button>
    </div>
  ) : undefined;

  return (
    <Screen header={header} footer={footer}>
      <ComposerGuard scope="public" className="mx-4 mt-4">
        <motion.div key={stepIndex} variants={fade} initial="hidden" animate="show" className="flex flex-col">
          {content}
        </motion.div>
      </ComposerGuard>
    </Screen>
  );
};

/**
 * 1.4 Public profile (product §1.4, design §7.1, SPEC §5.1): DiceBear shuffle / photo, name, handle with live
 * availability (+ tappable alternatives), class-year chips, major typeahead, bio, student ↔ org switch, and the
 * REQUIRED two-option age question (Yes / No, no default, never a checkbox). The draft lives in the flow store so a
 * refresh resumes here with everything typed. Photo upload happens AFTER `/auth/complete` (upload needs a session).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Camera, Check, Dices, Trash2 } from 'lucide-react';
import type { AuthCompleteRequest, HandleAvailabilityResponse, OrgCategory } from '@shared/core';
import { HANDLE_REGEX, LIMITS, MAJORS, ORG_CATEGORIES } from '@shared/core';
import { RESERVED_DISPLAY_WORDS } from '@shared/auth';
import { Avatar, Button, Chip, ChipGroup, IconButton, Input, Textarea } from '@/ui';
import { errorMessage, isApiError } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { consumePendingInvite, setMe, useMeOptional, useSessionStatus } from '@/lib/session';
import { toast } from '@/lib/toast';
import { uploadImage } from '@/lib/upload';
import { getSessionMe } from '@/stores/session';
import { authApi, authKeys } from '../api';
import { classOptions, generatedAvatarUrl, InlineError, randomAvatarSeed, resumePath, StepFooter, StepScreen, StepTitle } from '../shared';
import { useAuthFlow } from '../store';

const COPY = {
  title: 'Set up your public profile',
  sub: 'This is the real you — on Reels, Orbit, Messages, Marketplace and Roommates. Buzz stays anonymous and is never linked to it.',
  handleInvalid: 'Use 3–20 letters, numbers or underscores.',
  toOrg: 'Setting up a club or organization instead?',
  toStudent: 'Setting up a personal account instead?',
  uploadFailed: "Couldn't upload your photo. You can add it later.",
  expired: 'Your sign-up session expired. Enter your email again and we\'ll send a fresh code.',
} as const;

/** "Names can't include "{word}"." for a reserved word used as a whole word (case-insensitive). */
function reservedWordIn(name: string): string | null {
  const lower = ` ${name.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()} `;
  for (const w of RESERVED_DISPLAY_WORDS) if (lower.includes(` ${w} `)) return w;
  return null;
}

const CLASS_OPTIONS = classOptions();

export function ProfileScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const status = useSessionStatus();
  const signupToken = useAuthFlow((s) => s.signupToken);
  const university = useAuthFlow((s) => s.university);
  const draft = useAuthFlow((s) => s.draft);
  const { setDraft, setNotice, clear } = useAuthFlow.getState();
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [handleError, setHandleError] = useState<{ handle: string; message: string; alternatives: string[] } | null>(null);
  const [majorFocused, setMajorFocused] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  useScreenView('welcome_profile');

  useEffect(() => {
    if (!photo) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  /* ---------------------------------------------------------------- handle availability (live, 500 ms) */
  // `/api/auth/*` shares a 10-per-minute IP budget with start / verify / complete: check after a pause, cache per handle,
  // and when the check itself fails (429 / offline) let `/auth/complete` be the judge instead of blocking Continue.
  const handle = draft.handle;
  const handleFormatOk = HANDLE_REGEX.test(handle);
  const debouncedHandle = useDebounced(handleFormatOk ? handle : '', 500);
  const availability = useQuery<HandleAvailabilityResponse>({
    queryKey: authKeys.handle(debouncedHandle.toLowerCase()),
    queryFn: () => authApi.handleAvailable(debouncedHandle),
    enabled: debouncedHandle.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  const settled = debouncedHandle === handle;
  const live = settled && availability.data?.handle.toLowerCase() === handle.toLowerCase() ? availability.data : null;
  const checkFailed = settled && availability.isError;
  const serverHandleError = handleError && handleError.handle.toLowerCase() === handle.toLowerCase() ? handleError : null;
  const handleAvailable = (Boolean(live?.available) || (checkFailed && handleFormatOk)) && !serverHandleError;

  let handleMessage: { error?: string; helper?: string; alternatives: string[] } = { alternatives: [] };
  if (serverHandleError) handleMessage = { error: serverHandleError.message, alternatives: serverHandleError.alternatives };
  else if (handle.length > 0 && !handleFormatOk) handleMessage = { error: COPY.handleInvalid, alternatives: [] };
  else if (live && !live.available) {
    const alts = live.suggestions.slice(0, 2);
    handleMessage =
      live.reason === 'taken'
        ? { error: alts.length ? `@${handle} is taken. Try @${alts.join(' or @')}.` : `@${handle} is taken.`, alternatives: alts }
        : live.reason === 'reserved'
          ? { error: 'That handle is reserved. Try another one.', alternatives: alts }
          : { error: COPY.handleInvalid, alternatives: [] };
  } else if (live?.available) handleMessage = { helper: `@${handle} is yours`, alternatives: [] };

  /* ---------------------------------------------------------------- name / major / validity */
  const name = draft.displayName;
  const trimmedName = name.trim();
  const reserved = reservedWordIn(trimmedName);
  const nameOk = trimmedName.length >= LIMITS.displayNameMin && trimmedName.length <= LIMITS.displayNameMax && !reserved;
  const isOrg = draft.accountType === 'org';

  const majorQuery = draft.major.trim().toLowerCase();
  const majorSuggestions = useMemo(() => {
    if (!majorFocused || majorQuery.length === 0) return [];
    const exact = MAJORS.some((m) => m.toLowerCase() === majorQuery);
    if (exact) return [];
    return MAJORS.filter((m) => m.toLowerCase().includes(majorQuery)).slice(0, 6);
  }, [majorFocused, majorQuery]);

  const classValue = draft.classKind === 'undergrad' && draft.classYear ? String(draft.classYear) : (draft.classKind ?? null);
  const seed = draft.avatarSeed ?? (handle || 'universe');
  const avatarSrc = photoUrl ?? generatedAvatarUrl(seed, draft.accountType);

  const canContinue = nameOk && handleFormatOk && handleAvailable && draft.isAdult !== null && (!isOrg || draft.orgCategory !== null) && !busy;

  /* ---------------------------------------------------------------- guards */
  if (!signupToken) {
    if (status === 'onboarding' && me) return <Navigate to={resumePath(me)} replace />;
    return <Navigate to={routes.welcomeStep('email')} replace />;
  }

  /* ---------------------------------------------------------------- submit */
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canContinue) return;
    setBusy(true);
    setFormError(null);
    try {
      const body: AuthCompleteRequest = {
        signupToken,
        displayName: trimmedName,
        handle,
        accountType: draft.accountType,
        isAdult: draft.isAdult === true,
        avatarSeed: seed,
        bio: draft.bio.trim(),
      };
      if (isOrg) body.orgCategory = draft.orgCategory;
      else {
        body.classYear = draft.classYear;
        body.classKind = draft.classKind;
        body.major = draft.major.trim() || null;
      }
      const invite = consumePendingInvite();
      if (invite) body.inviteCode = invite;

      const res = await authApi.complete(body);
      const pendingPhoto = photo;
      // Session first (status → 'onboarding'), then the flow store: whichever render lands first ends on /guidelines.
      setMe(res.user);
      clear();
      track('signup_completed', { accountType: res.user.accountType });
      track('onboarding_step', { step: 'profile' });
      navigate(routes.welcomeStep('guidelines'), { replace: true });

      // Photo: needs a session, so it goes AFTER complete (#29 accepts kind 'avatar' before the guidelines step).
      // Merge ONLY the avatar into the live session: the PATCH snapshot can predate an "I agree" that already resolved,
      // and replacing the whole MeUser would flip `guidelinesAccepted` back and bounce the user to /welcome/guidelines.
      if (pendingPhoto) {
        void uploadImage(pendingPhoto, { kind: 'avatar' })
          .then((u) => authApi.patchMe({ avatarUrl: u.url }))
          .then((patched) => {
            const current = getSessionMe();
            if (current && current.id === patched.id) setMe({ ...current, avatarUrl: patched.avatarUrl });
          })
          .catch(() => toast.error(COPY.uploadFailed));
      }
    } catch (err) {
      if (isApiError(err, 'handle_taken') || isApiError(err, 'handle_invalid') || isApiError(err, 'handle_reserved')) {
        const suggestions = ((err.details as { suggestions?: string[] } | undefined)?.suggestions ?? []).slice(0, 2);
        setHandleError({ handle, message: isApiError(err, 'handle_taken') && suggestions.length ? `@${handle} is taken. Try @${suggestions.join(' or @')}.` : err.message, alternatives: suggestions });
      } else if (isApiError(err, 'signup_token_invalid')) {
        clear();
        setNotice(COPY.expired);
        navigate(routes.welcomeStep('email'), { replace: true });
      } else if (isApiError(err, 'content_blocked')) {
        setFormError(err.message);
        handleModerationError(err);
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  const onPhotoPicked = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFormError('Pick a JPEG, PNG or WebP image.');
      return;
    }
    setPhoto(file);
  };

  /* ---------------------------------------------------------------- render */
  return (
    <StepScreen
      step="profile"
      title="Your profile"
      back={() => {
        // The code behind this step is spent; "back" means start over with an address.
        clear();
        navigate(routes.welcomeStep('email'), { replace: true });
      }}
      footer={
        <StepFooter>
          <Button type="submit" form="uv-profile-form" size="lg" fullWidth disabled={!canContinue} loading={busy} rightIcon={ArrowRight}>
            Continue
          </Button>
        </StepFooter>
      }
    >
      <StepTitle title={COPY.title} sub={COPY.sub} />

      <form id="uv-profile-form" onSubmit={submit} className="flex flex-col gap-5" noValidate>
        {/* avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Avatar src={avatarSrc} name={trimmedName || 'You'} size="2xl" shape={isOrg ? 'org' : 'circle'} ring="orbit" />
            <IconButton
              icon={Camera}
              aria-label="Upload photo"
              variant="accent"
              size="sm"
              className="absolute -right-1 -bottom-1"
              onClick={() => fileInput.current?.click()}
            />
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              tabIndex={-1}
              aria-hidden
              className="hidden"
              onChange={(e) => {
                onPhotoPicked(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={Dices}
              disabled={Boolean(photo)}
              onClick={() => setDraft({ avatarSeed: randomAvatarSeed() })}
            >
              Shuffle
            </Button>
            {photo ? (
              <Button type="button" variant="ghost" size="sm" leftIcon={Trash2} onClick={() => setPhoto(null)}>
                Remove photo
              </Button>
            ) : (
              <Button type="button" variant="ghost" size="sm" leftIcon={Camera} onClick={() => fileInput.current?.click()}>
                Upload photo
              </Button>
            )}
          </div>
          {university ? <p className="type-caption text-ink-3">{university.name}</p> : null}
        </div>

        {/* name */}
        <Input
          label={isOrg ? 'Organization name' : 'Name'}
          placeholder={isOrg ? 'Your organization' : 'Your name'}
          autoComplete={isOrg ? 'organization' : 'name'}
          maxLength={LIMITS.displayNameMax}
          value={name}
          onChange={(e) => {
            setDraft({ displayName: e.target.value });
            if (formError) setFormError(null);
          }}
          error={reserved ? `Names can't include "${reserved}".` : undefined}
          helper={!reserved && trimmedName.length > 0 && trimmedName.length < LIMITS.displayNameMin ? `At least ${LIMITS.displayNameMin} characters.` : undefined}
        />

        {/* handle */}
        <div className="flex flex-col gap-2">
          <Input
            label="Handle"
            prefix="@"
            placeholder="yourhandle"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="username"
            maxLength={LIMITS.handleMax}
            value={handle}
            onChange={(e) => setDraft({ handle: e.target.value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, LIMITS.handleMax) })}
            error={handleMessage.error}
            helper={handleMessage.helper}
            rightSlot={live?.available && !serverHandleError ? <Check size={18} strokeWidth={2.5} aria-label="Available" className="text-success" /> : undefined}
          />
          {handleMessage.alternatives.length > 0 ? (
            <div className="flex flex-wrap gap-2" aria-label="Available alternatives">
              {handleMessage.alternatives.map((alt) => (
                <Chip key={alt} size="sm" onClick={() => setDraft({ handle: alt })}>
                  @{alt}
                </Chip>
              ))}
            </div>
          ) : null}
        </div>

        {isOrg ? (
          <div className="flex flex-col gap-2">
            <span className="type-footnote text-ink-2">Category</span>
            <ChipGroup<OrgCategory>
              aria-label="Organization category"
              options={ORG_CATEGORIES.map((c) => ({ value: c, label: c }))}
              value={draft.orgCategory}
              onChange={(v: OrgCategory) => setDraft({ orgCategory: v })}
            />
          </div>
        ) : (
          <>
            {/* class year */}
            <div className="flex flex-col gap-2">
              <span className="type-footnote text-ink-2">Class year</span>
              <ChipGroup
                aria-label="Class year"
                options={CLASS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                value={classValue}
                onChange={(v: string) => {
                  const opt = CLASS_OPTIONS.find((o) => o.value === v);
                  if (opt) setDraft({ classYear: opt.classYear, classKind: opt.classKind });
                }}
              />
            </div>

            {/* major typeahead */}
            <div className="relative flex flex-col">
              <Input
                label="Major"
                placeholder="Start typing — e.g. Mechanical Engineering"
                autoComplete="off"
                maxLength={80}
                value={draft.major}
                onChange={(e) => setDraft({ major: e.target.value })}
                onFocus={() => setMajorFocused(true)}
                onBlur={() => setMajorFocused(false)}
                role="combobox"
                aria-expanded={majorSuggestions.length > 0}
                aria-controls="uv-major-options"
                aria-autocomplete="list"
              />
              {majorSuggestions.length > 0 ? (
                <ul
                  id="uv-major-options"
                  role="listbox"
                  className="absolute top-full right-0 left-0 z-(--z-sticky) mt-1 overflow-hidden rounded-md border border-line bg-surface-2 shadow-md"
                >
                  {majorSuggestions.map((m) => (
                    <li key={m} role="option" aria-selected={false}>
                      <button
                        type="button"
                        className="press flex min-h-11 w-full items-center px-3.5 text-left type-body text-ink hover:bg-surface-3"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setDraft({ major: m });
                          setMajorFocused(false);
                        }}
                      >
                        {m}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </>
        )}

        {/* bio */}
        <Textarea
          label={isOrg ? 'About (optional)' : 'Bio (optional)'}
          placeholder={isOrg ? 'One line about your organization' : 'One line about you'}
          minRows={2}
          maxRows={4}
          maxLength={LIMITS.bio}
          showCount
          value={draft.bio}
          onChange={(e) => setDraft({ bio: e.target.value })}
        />

        {/* age — REQUIRED two-option choice, no default (SPEC §5.1) */}
        <div className="flex flex-col gap-2">
          <span className="type-footnote text-ink-2">Are you 18 or older?</span>
          <ChipGroup<'yes' | 'no'>
            aria-label="Are you 18 or older?"
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
            value={draft.isAdult === null ? null : draft.isAdult ? 'yes' : 'no'}
            onChange={(v: 'yes' | 'no') => setDraft({ isAdult: v === 'yes' })}
          />
          <span className="type-caption text-ink-3">Never shown on your profile.</span>
        </div>

        {/* org switch */}
        <button
          type="button"
          className="press self-start rounded-sm py-2 type-label-sm text-accent-ink"
          onClick={() => setDraft(isOrg ? { accountType: 'student', orgCategory: null } : { accountType: 'org', classYear: null, classKind: null, major: '' })}
        >
          {isOrg ? COPY.toStudent : COPY.toOrg}
        </button>

        {formError ? <InlineError>{formError}</InlineError> : null}
      </form>
    </StepScreen>
  );
}

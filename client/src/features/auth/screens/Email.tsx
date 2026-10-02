/**
 * 1.2 University email (product §1.2, design §7.1): live campus chip via `GET /auth/domain` (domain-keyed, 500 ms
 * debounce), new-campus chip, inline errors with the product copy (never toasts), help sheet, CTA above the keyboard.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, Mail, Sparkles } from 'lucide-react';
import type { AuthStartRequest } from '@shared/core';
import { Button, CampusBadge, Input, Sheet } from '@/ui';
import { errorMessage, isApiError } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { useDebounced } from '@/lib/hooks';
import { fadeOnly, fadeUp, useReducedMotionPref } from '@/lib/motion';
import { routes } from '@/lib/links';
import { getPendingInvite, useMeOptional, useSessionStatus } from '@/lib/session';
import { authApi, authKeys } from '../api';
import { InlineError, looksLikeEmail, resumePath, StepFooter, StepScreen, StepTitle } from '../shared';
import { useAuthFlow } from '../store';

const COPY = {
  malformed: "Something's off with that address. Check it and try again.",
  rateLimited: 'Too many tries. Give it a minute, then try again.',
  help: 'We accept .edu, .edu.xx and .ac.xx addresses plus a list of known university domains worldwide. Personal and alumni addresses aren\'t supported yet.',
} as const;

function startErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    switch (err.code) {
      case 'validation_failed':
      case 'bad_request':
        return COPY.malformed;
      case 'rate_limited':
      case 'otp_cooldown':
        return COPY.rateLimited;
      case 'email_personal':
      case 'email_disposable':
      case 'email_not_academic':
      case 'email_banned':
      case 'mail_unavailable':
        return err.message;
      default:
        return errorMessage(err);
    }
  }
  return errorMessage(err);
}

export function EmailScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const status = useSessionStatus();
  const reduced = useReducedMotionPref();
  const stored = useAuthFlow((s) => s.email);
  const storedResendAt = useAuthFlow((s) => s.resendAvailableAt);
  const { setEmail: storeEmail, setStart, setNotice } = useAuthFlow.getState();
  const [email, setEmail] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  /** One-shot notice left by another step (expired sign-up session); consumed on mount, cleared on typing. */
  const [notice, setLocalNotice] = useState<string | null>(() => useAuthFlow.getState().notice);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const started = useRef(false);
  useScreenView('welcome_email');

  const trimmed = email.trim().toLowerCase();
  const parses = looksLikeEmail(trimmed);
  // The live chip looks up the DOMAIN only (local-part edits never refetch) after a 500 ms pause: `/api/auth/*` shares
  // one 10-requests-per-minute IP budget with start / verify / complete, so lookups are kept to a handful per sign-up.
  const domain = parses ? trimmed.slice(trimmed.lastIndexOf('@') + 1) : '';
  const debounced = useDebounced(domain, 500);

  const lookup = useQuery({
    queryKey: authKeys.domain(debounced),
    queryFn: () => authApi.lookupDomain(debounced),
    enabled: debounced.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const looked = debounced && debounced === domain && lookup.data ? lookup.data : null;
  // Personal / disposable providers are shown inline right away; Send stays enabled because the server has the final
  // say (an operator-listed STAFF_EMAILS address passes the gate even on a personal domain, SPEC §4.2.15).
  const liveError = looked && (looked.status === 'personal' || looked.status === 'disposable') ? looked.message : null;

  useEffect(() => {
    if (useAuthFlow.getState().notice) setNotice(null);
  }, [setNotice]);

  if (status === 'onboarding' && me) return <Navigate to={resumePath(me)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parses || busy) return;
    setBusy(true);
    setError(null);
    if (!started.current) {
      started.current = true;
      track('signup_started');
    }
    try {
      const body: AuthStartRequest = { email: trimmed };
      const invite = getPendingInvite();
      if (invite) body.inviteCode = invite;
      const res = await authApi.start(body);
      setStart(res);
      track('signup_code_sent', { campus: res.university.isNew ? 'new' : 'known' });
      navigate(routes.welcomeStep('code'));
    } catch (err) {
      // A code for this exact address went out < 30 s ago: the inbox already has it — go type it.
      if (isApiError(err, 'otp_cooldown') && stored === trimmed && storedResendAt) {
        storeEmail(trimmed);
        navigate(routes.welcomeStep('code'));
        return;
      }
      setError(startErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const chip = looked && (looked.status === 'known' || looked.status === 'new') ? looked : null;
  const shownError = error ?? liveError ?? null;

  return (
    <StepScreen
      step="email"
      title="University email"
      footer={
        <StepFooter>
          <Button type="submit" form="uv-email-form" size="lg" fullWidth disabled={!parses} loading={busy} rightIcon={ArrowRight}>
            Send code
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-x-4">
            <button
              type="button"
              onClick={() => {
                if (parses) storeEmail(trimmed);
                navigate(routes.welcomeStep('password'));
              }}
              className="press min-h-11 rounded-sm px-2 type-label-sm text-accent-ink"
            >
              Sign in with password
            </button>
            <button type="button" onClick={() => setHelpOpen(true)} className="press min-h-11 rounded-sm px-2 type-label-sm text-ink-2">
              My school email isn't accepted
            </button>
          </div>
        </StepFooter>
      }
    >
      <StepTitle title="What's your university email?" sub="We'll send a 6-digit code. No password needed." />
      {notice ? <InlineError>{notice}</InlineError> : null}
      <form id="uv-email-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input
          label="University email"
          size="lg"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@university.edu"
          autoFocus
          leftIcon={Mail}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
            if (notice) setLocalNotice(null);
          }}
          error={shownError ?? undefined}
        />
        <AnimatePresence initial={false}>
          {chip ? (
            <motion.div
              key={`${chip.status}:${chip.domain}`}
              variants={reduced ? fadeOnly : fadeUp}
              initial="hidden"
              animate="show"
              exit="hidden"
              className="flex items-center gap-2"
            >
              {chip.status === 'known' && chip.university ? (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
                    <Check size={14} strokeWidth={2.5} aria-hidden />
                  </span>
                  <CampusBadge name={chip.university.name} />
                </>
              ) : (
                <>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                    <Sparkles size={14} strokeWidth={2} aria-hidden />
                  </span>
                  <span className="type-footnote text-ink-2">New campus — you'll be the first from {chip.domain}.</span>
                </>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </form>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen} title="My school email isn't accepted">
        <p className="pb-2 type-body text-ink-2">{COPY.help}</p>
      </Sheet>
    </StepScreen>
  );
}

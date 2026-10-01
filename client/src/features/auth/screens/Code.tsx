/**
 * 1.3 Code (product §1.3, design §7.1): `OTPInput` (paste, autofill, auto-submit), resend with a 30 s countdown,
 * the 20 s "Nothing yet?" tip, inline errors with the product copy, the dev-inbox toast, returning-user shortcut.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import type { AuthStartRequest, OtpInvalidDetails } from '@shared/core';
import { Button, OTPInput } from '@/ui';
import { errorMessage, isApiError } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { firstName } from '@/lib/format';
import { routes } from '@/lib/links';
import { getPendingInvite, setMe, useMeOptional, useSessionStatus } from '@/lib/session';
import { toast } from '@/lib/toast';
import { authApi } from '../api';
import { InlineError, resumePath, StepFooter, StepScreen, StepTitle, useCountdown, useElapsed } from '../shared';
import { useAuthFlow } from '../store';

const COPY = {
  expired: 'That code expired. Tap Resend for a fresh one.',
  locked: 'Too many wrong codes. Request a new one to keep going.',
  rateLimited: 'Too many tries. Give it a minute, then try again.',
  tip: 'Nothing yet? University spam filters are aggressive — check Junk or Quarantine.',
  wrong: (n: number) => `That code doesn't match. ${n} ${n === 1 ? 'try' : 'tries'} left.`,
} as const;

function verifyErrorMessage(err: unknown): string {
  if (isApiError(err)) {
    switch (err.code) {
      case 'otp_invalid': {
        const left = (err.details as OtpInvalidDetails | undefined)?.attemptsLeft;
        return typeof left === 'number' ? COPY.wrong(left) : "That code doesn't match.";
      }
      case 'otp_expired':
        return COPY.expired;
      case 'otp_locked':
        return COPY.locked;
      case 'rate_limited':
      case 'otp_cooldown':
        return COPY.rateLimited;
      case 'validation_failed':
        return 'Enter the 6-digit code.';
      default:
        return errorMessage(err);
    }
  }
  return errorMessage(err);
}

export function CodeScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const sessionStatus = useSessionStatus();
  const email = useAuthFlow((s) => s.email);
  const devCode = useAuthFlow((s) => s.devCode);
  const resendAvailableAt = useAuthFlow((s) => s.resendAvailableAt);
  const { setStart, setNeedsProfile, clear } = useAuthFlow.getState();
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const wait = useCountdown(resendAvailableAt);
  const showTip = useElapsed(20_000);
  const verifying = useRef(false);
  useScreenView('welcome_code');

  useEffect(() => {
    if (devCode) toast.devInbox(devCode, () => setCode(devCode));
  }, [devCode]);

  if (sessionStatus === 'onboarding' && me) return <Navigate to={resumePath(me)} replace />;
  if (!email) return <Navigate to={routes.welcomeStep('email')} replace />;

  const verify = async (value: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setStatus('verifying');
    setError(null);
    try {
      const res = await authApi.verify({ email, code: value });
      setStatus('success');
      if (res.status === 'signed_in') {
        // Session first, flow store second (a render between the two must never bounce back to /email).
        setMe(res.user);
        clear();
        track('login');
        if (res.user.onboarding.completed) {
          // Returning user: the session is now 'ready' and foundation's RedirectIfReady (wrapping /welcome/*)
          // navigates to the stored `next` or Home — navigating here too would race it.
          toast.success(`Welcome back, ${firstName(res.user.displayName)}.`);
        } else {
          navigate(resumePath(res.user), { replace: true });
        }
        return;
      }
      setNeedsProfile(res); // `signup_verified` is tracked server-side (#4); the client is still signed out here
      navigate(routes.welcomeStep('profile'), { replace: true });
    } catch (err) {
      setStatus('error');
      setError(verifyErrorMessage(err));
    } finally {
      verifying.current = false;
    }
  };

  const resend = async () => {
    if (resending || wait > 0) return;
    setResending(true);
    try {
      const body: AuthStartRequest = { email };
      const invite = getPendingInvite();
      if (invite) body.inviteCode = invite;
      const res = await authApi.start(body);
      setStart(res);
      setCode('');
      setStatus('idle');
      setError(null);
      toast.success('New code sent.');
      track('signup_code_sent', { resend: true });
    } catch (err) {
      setError(isApiError(err, 'otp_cooldown') || isApiError(err, 'rate_limited') ? COPY.rateLimited : errorMessage(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <StepScreen
      step="code"
      title="Check your inbox"
      footer={
        <StepFooter>
          <Button variant="secondary" size="lg" fullWidth disabled={wait > 0} loading={resending} onClick={() => void resend()}>
            <span className="tabular-nums">{wait > 0 ? `Resend code in 0:${String(wait).padStart(2, '0')}` : 'Resend code'}</span>
          </Button>
        </StepFooter>
      }
    >
      <StepTitle
        title="Check your inbox"
        sub={
          <>
            We sent a 6-digit code to <span className="text-ink">{email}</span>.{' '}
            <button
              type="button"
              className="press rounded-sm type-label-sm text-accent-ink"
              onClick={() => navigate(routes.welcomeStep('email'))}
            >
              Change email
            </button>
          </>
        }
      />
      <div className="flex flex-col items-center gap-3 pt-2">
        <OTPInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (status === 'error' && v.length === 0) setStatus('idle');
          }}
          onComplete={(v) => void verify(v)}
          status={status}
          autoFocus
        />
        {error ? <InlineError className="w-full text-center">{error}</InlineError> : null}
        {showTip ? <p className="w-full text-center type-footnote text-ink-3">{COPY.tip}</p> : null}
      </div>
    </StepScreen>
  );
}

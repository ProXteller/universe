/**
 * Password sign-in (DECISIONS D9) — `/welcome/password`. For returning users who added a password in Settings.
 * Step 1: email + password. If two-step sign-in is on, step 2 asks for the code we just emailed (same OTPInput,
 * resend and dev-inbox behaviour as the code screen). New accounts are still created with an email code only.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowRight, Mail } from 'lucide-react';
import type { MeUser, OtpInvalidDetails, RateLimitedDetails } from '@shared/core';
import { Button, Input, OTPInput } from '@/ui';
import { PasswordInput } from '@/components';
import { errorMessage, isApiError } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { firstName } from '@/lib/format';
import { routes } from '@/lib/links';
import { setMe, useMeOptional, useSessionStatus } from '@/lib/session';
import { toast } from '@/lib/toast';
import { authApi } from '../api';
import { InlineError, looksLikeEmail, resumePath, StepFooter, StepScreen, StepTitle, useCountdown } from '../shared';
import { useAuthFlow } from '../store';

const COPY = {
  rateLimited: 'Too many tries. Give it a minute, then try again.',
  timedOut: 'That sign-in timed out. Enter your password again.',
  wrongCode: (n: number) => `That code doesn't match. ${n} ${n === 1 ? 'try' : 'tries'} left.`,
} as const;

function loginErrorMessage(err: unknown): string {
  if (!isApiError(err)) return errorMessage(err);
  switch (err.code) {
    case 'rate_limited':
    case 'otp_cooldown':
      return COPY.rateLimited;
    case 'validation_failed':
      return 'Enter your email and password.';
    default:
      // password_invalid / password_locked / email_* / mail_unavailable carry the product copy
      return err.message;
  }
}

function codeErrorMessage(err: unknown): string {
  if (!isApiError(err)) return errorMessage(err);
  switch (err.code) {
    case 'otp_invalid': {
      const left = (err.details as OtpInvalidDetails | undefined)?.attemptsLeft;
      return typeof left === 'number' ? COPY.wrongCode(left) : "That code doesn't match.";
    }
    case 'rate_limited':
    case 'otp_cooldown': {
      const wait = (err.details as RateLimitedDetails | undefined)?.retryAfterSec;
      return typeof wait === 'number' && wait > 60 ? `Too many tries. Try again in ${Math.ceil(wait / 60)} minutes.` : COPY.rateLimited;
    }
    case 'validation_failed':
      return 'Enter the 6-digit code.';
    default:
      return err.message;
  }
}

interface Challenge {
  token: string;
  email: string;
  resendAvailableAt: number;
}

export function PasswordScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const sessionStatus = useSessionStatus();
  const stored = useAuthFlow((s) => s.email);
  const { setEmail: storeEmail, clear } = useAuthFlow.getState();
  const [email, setEmail] = useState(stored);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [codeStatus, setCodeStatus] = useState<'idle' | 'verifying' | 'error' | 'success'>('idle');
  const [resending, setResending] = useState(false);
  const wait = useCountdown(challenge?.resendAvailableAt ?? null);
  const verifying = useRef(false);
  useScreenView(challenge ? 'welcome_password_code' : 'welcome_password');

  useEffect(() => {
    if (!challenge) setCode('');
  }, [challenge]);

  if (sessionStatus === 'onboarding' && me) return <Navigate to={resumePath(me)} replace />;

  const trimmed = email.trim().toLowerCase();
  const canSubmit = looksLikeEmail(trimmed) && password.length > 0;

  const finish = (user: MeUser) => {
    // Session first, flow store second (a render between the two must never bounce back to /email).
    setMe(user);
    clear();
    track('login');
    if (user.onboarding.completed) toast.success(`Welcome back, ${firstName(user.displayName)}.`);
    else navigate(resumePath(user), { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      storeEmail(trimmed);
      const res = await authApi.passwordLogin({ email: trimmed, password });
      if (res.status === 'signed_in') {
        finish(res.user);
        return;
      }
      setPassword('');
      setChallenge({ token: res.challengeToken, email: res.email, resendAvailableAt: res.resendAvailableAt });
      if (res.devCode) {
        const dev = res.devCode;
        toast.devInbox(dev, () => setCode(dev));
      }
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!challenge || verifying.current) return;
    verifying.current = true;
    setCodeStatus('verifying');
    setError(null);
    try {
      const res = await authApi.passwordVerify({ challengeToken: challenge.token, code: value });
      setCodeStatus('success');
      if (res.status === 'signed_in') finish(res.user);
    } catch (err) {
      if (isApiError(err, 'challenge_invalid')) {
        setChallenge(null);
        setCodeStatus('idle');
        setError(COPY.timedOut);
        return;
      }
      setCodeStatus('error');
      setError(codeErrorMessage(err));
    } finally {
      verifying.current = false;
    }
  };

  const resend = async () => {
    if (!challenge || resending || wait > 0) return;
    setResending(true);
    try {
      const res = await authApi.passwordResend(challenge.token);
      setChallenge({ ...challenge, resendAvailableAt: res.resendAvailableAt });
      setCode('');
      setCodeStatus('idle');
      setError(null);
      if (res.devCode) {
        const dev = res.devCode;
        toast.devInbox(dev, () => setCode(dev));
      } else toast.success('New code sent.');
    } catch (err) {
      if (isApiError(err, 'challenge_invalid')) {
        setChallenge(null);
        setError(COPY.timedOut);
      } else setError(codeErrorMessage(err));
    } finally {
      setResending(false);
    }
  };

  if (challenge) {
    return (
      <StepScreen
        step="code"
        title="Two-step sign-in"
        back={() => {
          setChallenge(null);
          setError(null);
        }}
        footer={
          <StepFooter>
            <Button variant="secondary" size="lg" fullWidth disabled={wait > 0} loading={resending} onClick={() => void resend()}>
              <span className="tabular-nums">{wait > 0 ? `Resend code in 0:${String(wait).padStart(2, '0')}` : 'Resend code'}</span>
            </Button>
          </StepFooter>
        }
      >
        <StepTitle
          title="One more step"
          sub={
            <>
              Your password was right. Two-step sign-in is on, so we sent a 6-digit code to{' '}
              <span className="text-ink">{challenge.email}</span>.
            </>
          }
        />
        <div className="flex flex-col items-center gap-3 pt-2">
          <OTPInput
            value={code}
            onChange={(v) => {
              setCode(v);
              if (codeStatus === 'error' && v.length === 0) setCodeStatus('idle');
            }}
            onComplete={(v) => void verify(v)}
            status={codeStatus}
            autoFocus
          />
          {error ? <InlineError className="w-full text-center">{error}</InlineError> : null}
        </div>
      </StepScreen>
    );
  }

  return (
    <StepScreen
      step="email"
      title="Sign in with password"
      footer={
        <StepFooter>
          <Button type="submit" form="uv-password-form" size="lg" fullWidth disabled={!canSubmit} loading={busy} rightIcon={ArrowRight}>
            Sign in
          </Button>
          <button
            type="button"
            onClick={() => navigate(routes.welcomeStep('email'))}
            className="press mx-auto min-h-11 rounded-sm px-2 type-label-sm text-ink-2"
          >
            Forgot it? Use an email code instead
          </button>
        </StepFooter>
      }
    >
      <StepTitle title="Welcome back" sub="Sign in with the password you set in Settings." />
      <form id="uv-password-form" onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input
          label="University email"
          size="lg"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="you@university.edu"
          autoFocus={!stored}
          leftIcon={Mail}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
        />
        <PasswordInput
          label="Password"
          size="lg"
          autoComplete="current-password"
          autoFocus={Boolean(stored)}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          error={error ?? undefined}
        />
      </form>
    </StepScreen>
  );
}

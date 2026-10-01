/**
 * 1.5 Community Guidelines acceptance (product §1.5; SPEC §2.3: one primary "I agree", no Switch). The five rules
 * on a hero Card; "Read the full guidelines" opens admin's `GuidelinesContent variant="sheet"` and degrades to a
 * link to `/guidelines` when that export is still the stub (it renders nothing — detected at runtime, R6).
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { EyeOff, HeartHandshake, Scale, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Card, Sheet } from '@/ui';
import { GuidelinesContent } from '@/features/admin';
import { errorMessage } from '@/lib/api';
import { track, useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { setMe, useMeOptional } from '@/lib/session';
import { authApi } from '../api';
import { InlineError, StepFooter, StepScreen, StepTitle } from '../shared';

const RULES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: HeartHandshake, title: 'Be decent.', body: 'No harassment, bullying, hate or pile-ons. Go after ideas, not people.' },
  { icon: ShieldAlert, title: 'No threats.', body: 'Threats against people or places are removed and escalated.' },
  { icon: EyeOff, title: "Don't name and shame.", body: 'No private info, no calling out individuals in Buzz, no photos of people without consent.' },
  { icon: Scale, title: 'Keep it legal.', body: 'No drugs, weapons, fake IDs, alcohol sales or cheating services.' },
  {
    icon: ShieldCheck,
    title: 'Anonymous to students, accountable to the rules.',
    body: 'Buzz hides who you are from everyone on campus. Our safety team can act on posts that break these rules, and serious violations lead to bans.',
  },
];

/** Hosts admin's GuidelinesContent; if it painted nothing (stub), shows the link fallback instead. */
function FullGuidelines({ open, onOpenChange }: { open: boolean; onOpenChange(o: boolean): void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => setEmpty((host.current?.childElementCount ?? 0) === 0), 60);
    return () => window.clearTimeout(t);
  }, [open]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Community Guidelines" detents={['full']}>
      <div ref={host} className="pb-2">
        <GuidelinesContent variant="sheet" />
      </div>
      {empty ? (
        <div className="flex flex-col gap-3 pb-2">
          <p className="type-body text-ink-2">The full guidelines open on their own page.</p>
          <Button variant="secondary" to={routes.guidelines()} onClick={() => onOpenChange(false)}>
            Open the Community Guidelines
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}

export function GuidelinesScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullOpen, setFullOpen] = useState(false);
  useScreenView('welcome_guidelines');

  if (!me) return <Navigate to={routes.welcome()} replace />;
  if (me.onboarding.guidelinesAccepted) return <Navigate to={routes.welcomeStep('follow')} replace />;

  const agree = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await authApi.acceptGuidelines();
      setMe(user);
      track('onboarding_step', { step: 'guidelines' });
      navigate(routes.welcomeStep('follow'), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepScreen
      step="guidelines"
      title="Ground rules"
      back={false}
      footer={
        <StepFooter>
          {error ? <InlineError>{error}</InlineError> : null}
          <Button size="lg" fullWidth loading={busy} onClick={() => void agree()}>
            I agree
          </Button>
        </StepFooter>
      }
    >
      <StepTitle title="A few ground rules" sub="UniVerse works because students trust it. Agree to these and you're in." />
      <Card variant="hero">
        <ol className="flex flex-col gap-4">
          {RULES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent-ink">
                <Icon size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="type-headline text-ink">{title}</p>
                <p className="type-footnote text-ink-2">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <button type="button" onClick={() => setFullOpen(true)} className="press self-start rounded-sm py-2 type-label-sm text-accent-ink">
        Read the full guidelines
      </button>
      <FullGuidelines open={fullOpen} onOpenChange={setFullOpen} />
    </StepScreen>
  );
}

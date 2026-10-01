/**
 * The Buzz guidelines gate (SPEC §5.3, safety §1.1): an INLINE in-pane panel, never a Sheet / Dialog / portal.
 * Required before the first Buzz read; the slice makes no `/api/buzz` request until `useBuzzGate().accepted`.
 * [I understand] → POST /me/guidelines {kind:'buzz'} · [Not now] → back to the previous non-Buzz tab (pane) / Back (pages).
 */
import { useState, type FC } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, VenetianMask } from 'lucide-react';
import { GUIDELINES_VERSION, type MeUser } from '@shared/core';
import { Button } from '@/ui';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { setMe, useMeOptional } from '@/lib/session';
import { toast } from '@/lib/toast';

export function useBuzzGate(): { accepted: boolean } {
  const me = useMeOptional();
  return { accepted: me !== null && me.buzzGateAcceptedVersion === GUIDELINES_VERSION };
}

const RULES = [
  'Nobody on campus can see who wrote a buzz.',
  'Don\'t name or target individuals.',
  'Threats, harassment and illegal sales get removed, and repeat offenders get banned.',
];

export interface BuzzGatePanelProps {
  /** `pane`: "Not now" goes back to the previous tab · `page`: "Back" (thread / mine pages). */
  variant: 'pane' | 'page';
  onDismiss(): void;
  className?: string;
}

export const BuzzGatePanel: FC<BuzzGatePanelProps> = ({ variant, onDismiss, className }) => {
  const [busy, setBusy] = useState(false);

  const accept = async (): Promise<void> => {
    setBusy(true);
    try {
      const me = await api.post<MeUser>('/me/guidelines', { kind: 'buzz', version: GUIDELINES_VERSION });
      setMe(me);
      track('buzz_gate_accepted');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="buzz-gate-title" className={className}>
      <div className="mx-4 flex flex-col gap-5 rounded-lg border border-accent-line bg-surface-1 p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
            <VenetianMask size={22} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="buzz-gate-title" className="type-title-3 text-ink">Before your first buzz</h2>
            <p className="type-caption text-ink-3">Anonymous to students, accountable to moderators.</p>
          </div>
        </div>
        <ul className="flex flex-col gap-3">
          {RULES.map((rule, i) => (
            <li key={rule} className="flex items-start gap-3">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft type-micro text-accent-ink tabular-nums">{i + 1}</span>
              <span className="type-body text-ink-2">{rule}</span>
            </li>
          ))}
        </ul>
        <p className="type-footnote text-ink-3">
          Every buzz stays linked to your account for safety. Moderators act on content without seeing who wrote it; only a very small
          number of admins can reveal an author, for serious cases, with a written reason that is permanently logged.{' '}
          <Link to={routes.guidelines('buzz-anonymity')} className="text-accent-ink underline-offset-2 hover:underline">
            How Buzz anonymity works
          </Link>
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" size="lg" fullWidth loading={busy} onClick={() => void accept()}>
            I understand
          </Button>
          <Button variant="ghost" size="md" fullWidth onClick={onDismiss} leftIcon={variant === 'page' ? ArrowLeft : undefined}>
            {variant === 'page' ? 'Back' : 'Not now'}
          </Button>
        </div>
      </div>
    </section>
  );
};

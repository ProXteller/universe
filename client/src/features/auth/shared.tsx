/**
 * Shared pieces of the onboarding flow: the step layout (compact header + StepDots 5), step resolution, the client
 * twin of the server's generated-avatar URL, class-year chips, and small hooks.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import type { AccountType, ClassKind, MeUser } from '@shared/core';
import { API_BASE } from '@shared/core';
import type { OnboardingStep } from '@shared/auth';
import { PageHeader, Screen, StepDots } from '@/ui';
import { fadeOnly, fadeUp, useReducedMotionPref } from '@/lib/motion';
import { routes, type WelcomeStep } from '@/lib/links';

/* ------------------------------------------------------------------ steps */

export const STEP_INDEX: Record<OnboardingStep, number> = { email: 1, code: 2, profile: 3, guidelines: 4, follow: 5 };
export const STEP_TOTAL = 5;

/** Where a signed-in session that is mid-onboarding belongs (profile is part of `/auth/complete`, so never `profile`). */
export function resumeStep(me: MeUser): WelcomeStep | null {
  if (!me.onboarding.guidelinesAccepted) return 'guidelines';
  if (!me.onboarding.completed) return 'follow';
  return null;
}

export function resumePath(me: MeUser): string {
  const step = resumeStep(me);
  return step ? routes.welcomeStep(step) : routes.home('reels');
}

/* ------------------------------------------------------------------ layout */

interface StepScreenProps {
  step: OnboardingStep;
  /** The bar title (the large `type-display` title is written by the screen itself). */
  title: string;
  back?: boolean | (() => void);
  footer?: ReactNode;
  children: ReactNode;
}

/** Compact `PageHeader` (back + a11y title) with `StepDots total={5}` beneath, then the step body with 16px gutters. */
export function StepScreen({ step, title, back = true, footer, children }: StepScreenProps) {
  const reduced = useReducedMotionPref();
  return (
    <Screen
      header={
        <PageHeader
          title={<span className="sr-only">{title}</span>}
          back={back}
          below={
            <div className="px-4 pb-2">
              <StepDots total={STEP_TOTAL} current={STEP_INDEX[step]} />
            </div>
          }
        />
      }
      footer={footer}
    >
      <motion.div
        variants={reduced ? fadeOnly : fadeUp}
        initial="hidden"
        animate="show"
        className="flex flex-1 flex-col gap-5 px-4 pt-3"
      >
        {children}
      </motion.div>
    </Screen>
  );
}

/** Title + sub of a step, `type-display` per design §7.1. */
export function StepTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="type-display text-ink">{title}</h1>
      {sub ? <p className="type-body text-ink-2">{sub}</p> : null}
    </div>
  );
}

/** The sticky CTA area that sits above the keyboard (Screen `footer`). */
export function StepFooter({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-3 px-4 pt-3 pb-4">{children}</div>;
}

/** Inline error under a control group (never a toast — product §2.1). */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`type-footnote text-danger ${className ?? ''}`}>
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ avatars */

/**
 * Client twin of the server's `avatarUrlFor` for a not-yet-created account (the DiceBear preview on the profile
 * step). After `/auth/complete` the server's `MeUser.avatarUrl` is the source of truth.
 */
export function generatedAvatarUrl(seed: string, type: AccountType): string {
  return `${API_BASE}/avatars/${encodeURIComponent(seed)}.svg?t=${type}`;
}

const SEED_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh DiceBear seed ("Shuffle"). Matches the server's `avatarSeed` regex (`^[\w.:-]+$`). */
export function randomAvatarSeed(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `s_${Array.from(bytes, (b) => SEED_ALPHABET[b % SEED_ALPHABET.length]).join('')}`;
}

/* ------------------------------------------------------------------ class year */

export interface ClassOption {
  value: string;
  label: string;
  classYear: number | null;
  classKind: ClassKind;
}

/**
 * Product §1.4: the four current undergraduate classes computed from today's date, then Grad and Other.
 * July onwards the freshman class graduates in `year + 4`; before that the academic year is still `year − 1`'s.
 */
export function classOptions(today = new Date()): ClassOption[] {
  const y = today.getFullYear();
  const fall = today.getMonth() >= 6;
  const first = fall ? y + 1 : y;
  const years = [first, first + 1, first + 2, first + 3];
  return [
    ...years.map((year) => ({ value: String(year), label: `Class of ${year}`, classYear: year, classKind: 'undergrad' as const })),
    { value: 'grad', label: 'Grad', classYear: null, classKind: 'grad' },
    { value: 'other', label: 'Other', classYear: null, classKind: 'other' },
  ];
}

/* ------------------------------------------------------------------ hooks */

/** Seconds left until `until` (0 when past / null), ticking once a second. */
export function useCountdown(until: number | null): number {
  const compute = () => (until ? Math.max(0, Math.ceil((until - Date.now()) / 1000)) : 0);
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    setLeft(compute());
    if (!until) return;
    const t = window.setInterval(() => setLeft(compute()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  return left;
}

/** `true` once `ms` have elapsed since mount (the "Nothing yet?" tip). */
export function useElapsed(ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return done;
}

/** Loose "does this look like an address" check for enabling the CTA (the server is the real gate). */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

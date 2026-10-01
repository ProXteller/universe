/**
 * Route guards (SPEC §4.4.3 / §4.5).
 *   P  `RedirectIfReady`   — public-only; ready users go to `?next=` (safe) or `/`. Signed-in-but-not-onboarded users
 *                            are allowed (the auth flow resumes them at the right step).
 *   A  `RequireOnboarded`  — signed in + onboarded. `'restricted'` sessions are admitted on `/settings/account-status`
 *                            only; everywhere else they render nothing and the SanctionGate (AppShell) covers the frame.
 *      `RequireAuth`       — any signed-in session (onboarding or not).
 *      `RequireStaff`      — moderator / admin, else `NotFound` (404 for others, §4.5).
 */
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { NotFound, PageLoader } from '@/components';
import { routes } from '@/lib/links';
import { consumePendingNext, getPendingNext, setPendingInvite, setPendingNext, useMeOptional, useSessionStatus } from '@/lib/session';

function welcomeWithNext(pathname: string, search: string): string {
  const path = pathname + search;
  setPendingNext(path);
  return path === '/' ? routes.welcome() : routes.welcome(path);
}

/** In-app paths only (no protocol-relative or absolute URLs), never back into the auth flow. */
function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/welcome')) return null;
  return value;
}

export function RequireOnboarded({ children }: { children: ReactNode }) {
  const status = useSessionStatus();
  const { pathname, search } = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status === 'anon') return <Navigate to={welcomeWithNext(pathname, search)} replace />;
  if (status === 'onboarding') {
    setPendingNext(pathname + search);
    return <Navigate to={routes.welcome()} replace />;
  }
  if (status === 'restricted') return pathname === routes.accountStatus() ? <>{children}</> : null;
  return <>{children}</>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSessionStatus();
  const { pathname, search } = useLocation();
  if (status === 'loading') return <PageLoader />;
  if (status === 'anon') return <Navigate to={welcomeWithNext(pathname, search)} replace />;
  return <>{children}</>;
}

export function RequireStaff({ children }: { children: ReactNode }) {
  const me = useMeOptional();
  if (!me || (me.role !== 'moderator' && me.role !== 'admin')) return <NotFound />;
  return <>{children}</>;
}

/** `/welcome/*`: keeps `?next=` / `?invite=` in sessionStorage (foundation), bounces ready sessions out. */
export function RedirectIfReady({ children }: { children: ReactNode }) {
  const status = useSessionStatus();
  const [params] = useSearchParams();
  const next = params.get('next');
  const invite = params.get('invite');

  useEffect(() => {
    if (next) setPendingNext(next);
    if (invite) setPendingInvite(invite);
  }, [next, invite]);

  if (status === 'loading') return <PageLoader />;
  if (status === 'ready' || status === 'restricted') {
    const stored = getPendingNext();
    if (stored) consumePendingNext();
    const target = safeNext(next) ?? stored ?? '/';
    return <Navigate to={target} replace />;
  }
  return <>{children}</>;
}

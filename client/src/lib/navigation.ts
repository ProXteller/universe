/**
 * Imperative navigation for non-component code (api.ts redirects, `openDm`, `logout`, ws `session.revoked`).
 * `App.tsx` registers the router's `navigate` once; before that (or outside the router) we fall back to a
 * hard location change so nothing is ever silently dropped.
 */
import type { NavigateFunction, NavigateOptions, To } from 'react-router-dom';

let navigator: NavigateFunction | null = null;

export function setNavigator(fn: NavigateFunction | null): void {
  navigator = fn;
}

export function navigateTo(to: To, opts?: NavigateOptions): void {
  if (navigator) {
    navigator(to, opts);
    return;
  }
  if (typeof window === 'undefined') return;
  const href = typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}${to.hash ?? ''}`;
  if (opts?.replace) window.location.replace(href);
  else window.location.assign(href);
}

/** Current `pathname` (router-independent so api.ts can consult it without hooks). */
export function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname;
}

export function currentPathWithSearch(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname + window.location.search;
}

/** Routes on which the global 401 / `onboarding_required` redirects are never performed (SPEC §4.4.1). */
export function isRedirectExemptPath(pathname: string = currentPathname()): boolean {
  return pathname.startsWith('/welcome') || pathname.startsWith('/legal/') || pathname === '/guidelines';
}

/**
 * Motion presets — the single source for every animation number in the client (design §4.1).
 * Never inline stiffness / damping / durations in a component: import from here.
 */
import { useSyncExternalStore } from 'react';
import type { Transition, Variants } from 'motion/react';

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 1 },   // taps, toggles, chips, nav pill, switch thumb
  smooth: { type: 'spring', stiffness: 320, damping: 32, mass: 1 },   // sheets, dialogs, pushed screens, FAB show/hide
  gentle: { type: 'spring', stiffness: 180, damping: 26, mass: 1 },   // hero entrances, onboarding step change, progress fill
  bouncy: { type: 'spring', stiffness: 420, damping: 17, mass: 0.9 }, // celebration ONLY: like burst, match %, RSVP tick, waitlist success
  settle: { type: 'spring', stiffness: 400, damping: 40, mass: 1 },   // drag release (sheet snap, pull-to-refresh) — pass gesture velocity
} satisfies Record<string, Transition>;

export const duration = { instant: 0.09, fast: 0.15, base: 0.22, slow: 0.32 } as const;   // seconds, for tweens
export const ease = {
  out: [0.22, 1, 0.36, 1],      // entrances, colour/opacity changes
  inOut: [0.65, 0, 0.35, 1],    // crossfades, indicator colour
  in: [0.4, 0, 1, 1],           // exits
} as const;

export const press = { whileTap: { scale: 0.97 }, transition: spring.snappy };      // buttons, cards that navigate
export const pressIcon = { whileTap: { scale: 0.9 }, transition: spring.snappy };   // icon buttons
export const fadeUp: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring.smooth } };
export const stagger = (step = 0.04) => ({ show: { transition: { staggerChildren: step, delayChildren: 0.02 } } });

/* ------------------------------------------------------------------------------------------------
 * Reduced motion (design §4.4)
 * ---------------------------------------------------------------------------------------------- */

export type SpringName = keyof typeof spring;

/** What every transform animation collapses to under reduced motion: a ≤150 ms opacity-friendly tween. */
export const reducedTween = { type: 'tween', duration: 0.12, ease: ease.out } satisfies Transition;
/** Standard exit: ≤150 ms so navigation never feels blocked (design §4.3). */
export const exitTween = { type: 'tween', duration: 0.12, ease: ease.in } satisfies Transition;
/** Opacity-only variant pair used instead of `fadeUp` when motion is reduced. */
export const fadeOnly: Variants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: reducedTween } };

const QUERY = '(prefers-reduced-motion: reduce)';
const mql: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;

let appSetting = false;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  mql?.addEventListener('change', fn);
  return () => {
    listeners.delete(fn);
    mql?.removeEventListener('change', fn);
  };
}

/** Non-hook read (event handlers, imperative animations). */
export function prefersReducedMotion(): boolean {
  return appSetting || Boolean(mql?.matches);
}

/**
 * Bridge for `settings.reduceMotion` (the session layer calls this whenever `me.settings` changes and on
 * logout with `false`). Also stamps `data-reduce-motion` on <html> so the CSS guard in base.css applies.
 */
export function setReducedMotionSetting(value: boolean): void {
  if (appSetting === value) return;
  appSetting = value;
  if (typeof document !== 'undefined') {
    if (value) document.documentElement.dataset.reduceMotion = 'true';
    else delete document.documentElement.dataset.reduceMotion;
  }
  listeners.forEach((fn) => fn());
}

/** `true` when the OS asks for reduced motion OR the user turned on Settings → Reduce motion. */
export function useReducedMotionPref(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

/** Pick a transition for the current preference: the preset, or the short tween when motion is reduced. */
export function motionSafe<T extends Transition>(transition: T, reduced: boolean): T | typeof reducedTween {
  return reduced ? reducedTween : transition;
}

/** Hook form of {@link motionSafe} for a named spring (named to avoid clashing with motion's `useSpring`). */
export function useSpringPreset(name: SpringName): Transition {
  const reduced = useReducedMotionPref();
  return reduced ? reducedTween : spring[name];
}

/** `fadeUp` normally, `fadeOnly` under reduced motion (transforms removed, opacity kept). */
export function useFadeUp(): Variants {
  return useReducedMotionPref() ? fadeOnly : fadeUp;
}

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';
import { setNavVisibility } from './navVisibility';
import { assignRef, useKeyboardInset } from './overlay';

export interface ScreenProps {
  /** Show the bottom nav on this route and reserve `--nav-clearance` under the content. Default `false`. */
  nav?: boolean;
  /** Content starts under the status bar (hero media, reels). Drops the safe-top spacer. */
  bleed?: boolean;
  /** Usually a `<PageHeader>`. Rendered inside the scroll container so it can stick and turn glass. */
  header?: ReactNode;
  /** Sticky bottom bar (chat composer, listing CTA). Sits where the nav would be; gets safe-bottom padding. */
  footer?: ReactNode;
  /** Receives the scroll container (for `InfiniteSentinel rootRef`, `FAB hideOnScroll`, scroll-to-top). */
  scrollRef?: RefObject<HTMLDivElement | null>;
  /** Applied to the content wrapper (a flex column that fills the space left by the header). */
  className?: string;
  children?: ReactNode;
}

export interface ScreenContextValue {
  /** The scroll container element (null until mounted). */
  scrollEl: HTMLDivElement | null;
  /** Non-scrolling layer above the content; `FAB` portals here so it never scrolls away. */
  floatEl: HTMLDivElement | null;
  nav: boolean;
  /** A `PageHeader` placed as a child (not via `header`) registers so the safe-top spacer is dropped. */
  registerHeader(): () => void;
}

export const ScreenContext = createContext<ScreenContextValue | null>(null);

/** The enclosing `<Screen>`, or null when rendered outside one. */
export function useScreen(): ScreenContextValue | null {
  return useContext(ScreenContext);
}

/**
 * The one scroll container per route (design §6.2). Lives inside `#frame`; never `position: fixed`.
 * `ref` → the root box, `scrollRef` → the scroll container.
 */
export const Screen = forwardRef<HTMLDivElement, ScreenProps>(function Screen(
  { nav = false, bleed = false, header, footer, scrollRef, className, children },
  ref,
) {
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [floatEl, setFloatEl] = useState<HTMLDivElement | null>(null);
  const [childHeaders, setChildHeaders] = useState(0);
  const keyboard = useKeyboardInset(Boolean(footer));

  useLayoutEffect(() => {
    setNavVisibility(nav);
  }, [nav]);

  const setScroll = useCallback(
    (node: HTMLDivElement | null) => {
      setScrollEl(node);
      assignRef(scrollRef, node);
    },
    [scrollRef],
  );

  const registerHeader = useCallback(() => {
    setChildHeaders((n) => n + 1);
    return () => setChildHeaders((n) => Math.max(0, n - 1));
  }, []);

  const ctx = useMemo<ScreenContextValue>(
    () => ({ scrollEl, floatEl, nav, registerHeader }),
    [scrollEl, floatEl, nav, registerHeader],
  );

  const hasHeader = Boolean(header) || childHeaders > 0;
  const bottomSpace = footer ? '16px' : nav ? 'var(--nav-clearance)' : 'calc(16px + var(--safe-bottom))';

  return (
    <ScreenContext.Provider value={ctx}>
      <div
        ref={ref}
        className="absolute inset-0 flex flex-col overflow-hidden bg-canvas text-ink"
        style={keyboard ? { paddingBottom: keyboard } : undefined}
      >
        <div
          ref={setScroll}
          data-screen-scroll=""
          className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain"
        >
          {!bleed && !hasHeader ? <div aria-hidden className="shrink-0" style={{ height: 'var(--safe-top)' }} /> : null}
          {header}
          <div className={cn('flex shrink-0 grow flex-col', className)}>{children}</div>
          {/* A spacer, not padding-bottom: end padding of a scroll container is not scrollable everywhere. */}
          <div aria-hidden className="shrink-0" style={{ height: bottomSpace }} />
        </div>
        {footer ? (
          <div
            className="relative z-(--z-sticky) shrink-0 border-t border-line-subtle bg-canvas"
            style={{ paddingBottom: keyboard ? 0 : 'var(--safe-bottom)' }}
          >
            {footer}
          </div>
        ) : null}
        <div ref={setFloatEl} className="pointer-events-none absolute inset-0 z-(--z-fab)" />
      </div>
    </ScreenContext.Provider>
  );
});

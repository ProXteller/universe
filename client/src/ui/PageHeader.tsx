import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';
import { useScreen } from './Screen';
import { useMergedRef } from './overlay';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /**
   * `large` (root tabs): 52px bar + a `type-title-1` row that scrolls away; the bar fades in a centred
   * title and glass once the large title is under it. `compact` (pushed screens, default): bar only,
   * transparent at scroll 0, glass after.
   */
  mode?: 'large' | 'compact';
  /** `true` = router back (falls back to `/` on a cold deep link) · a function = custom handler. */
  back?: boolean | (() => void);
  /** Up to two trailing `IconButton`s. */
  actions?: ReactNode;
  /** Sticky slot under the bar: search field, SegmentedControl, chips. */
  below?: ReactNode;
  /** Overlay the content instead of pushing it down (hero media under the bar). The title appears on scroll. */
  transparent?: boolean;
  className?: string;
}

const BAR_HEIGHT = 'calc(var(--safe-top) + var(--topbar-h))';

/**
 * Top of every non-Home screen. Pass it to `<Screen header={…}>`. It renders sibling elements (sentinel,
 * sticky bar, large title, sticky `below`) rather than one wrapper, because a sticky element only sticks
 * within its parent — and that parent has to be the scroll container. `ref` / `className` target the bar.
 * Scroll state comes from IntersectionObserver sentinels, never from scroll listeners.
 */
export const PageHeader = forwardRef<HTMLDivElement, PageHeaderProps>(function PageHeader(
  { title, subtitle, mode = 'compact', back, actions, below, transparent = false, className },
  ref,
) {
  const navigate = useNavigate();
  const screen = useScreen();
  const bar = useRef<HTMLDivElement | null>(null);
  const setBar = useMergedRef(ref, bar);
  const topSentinel = useRef<HTMLDivElement | null>(null);
  const largeTitle = useRef<HTMLDivElement | null>(null);
  const [barPx, setBarPx] = useState(62);
  const [scrolled, setScrolled] = useState(false);
  const [titleHidden, setTitleHidden] = useState(false);
  const large = mode === 'large';

  // A PageHeader written as a child of <Screen> (not via `header`) still owns the safe-top inset.
  const register = screen?.registerHeader;
  useLayoutEffect(() => register?.(), [register]);

  useLayoutEffect(() => {
    const h = bar.current?.offsetHeight;
    if (h) setBarPx(h);
  }, []);

  const root = screen?.scrollEl ?? null;

  useEffect(() => {
    const el = topSentinel.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setScrolled(!(entry?.isIntersecting ?? true)), { root, threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    const el = largeTitle.current;
    if (!large || !el || typeof IntersectionObserver === 'undefined') return;
    // Shrink the observed area by the bar: the title counts as gone once it is fully under the bar.
    const io = new IntersectionObserver(([entry]) => setTitleHidden(!(entry?.isIntersecting ?? true)), {
      root,
      rootMargin: `-${barPx}px 0px 0px 0px`,
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [large, root, barPx]);

  const onBack = () => {
    if (typeof back === 'function') {
      back();
      return;
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/', { replace: true });
  };

  const showBarTitle = large ? titleHidden : transparent ? scrolled : true;
  const glassOn = large ? titleHidden : scrolled;
  const fade = cn('transition-opacity duration-150 ease-out', showBarTitle ? 'opacity-100' : 'opacity-0');
  const backButton = back ? (
    <IconButton icon={ChevronLeft} aria-label="Back" variant={transparent && !scrolled ? 'glass' : 'ghost'} onClick={onBack} />
  ) : null;

  return (
    <>
      <div ref={topSentinel} aria-hidden className="pointer-events-none -mb-px h-px w-full shrink-0" />
      <div
        ref={setBar}
        className={cn('sticky top-0 z-(--z-topbar) w-full shrink-0', className)}
        style={{ paddingTop: 'var(--safe-top)', marginBottom: transparent ? `calc(${BAR_HEIGHT} * -1)` : undefined }}
      >
        {/* Pre-rendered glass layer: only its opacity changes (never animate backdrop-filter). */}
        <div
          aria-hidden
          className={cn('glass pointer-events-none absolute inset-0 transition-opacity duration-150 ease-out', glassOn ? 'opacity-100' : 'opacity-0')}
          style={{ borderWidth: '0 0 1px 0', boxShadow: 'none' }}
        />
        <div className="relative flex h-(--topbar-h) items-center px-2">
          {large ? (
            <>
              <div className="flex flex-1 basis-0 items-center">{backButton}</div>
              <div aria-hidden className={cn('max-w-[60%] min-w-0 truncate px-2 text-center type-title-3 text-ink', fade)}>
                {title}
              </div>
              <div className="flex flex-1 basis-0 items-center justify-end">{actions}</div>
            </>
          ) : (
            <>
              {backButton}
              <div className={cn('min-w-0 flex-1', back ? 'pl-1' : 'pl-2', fade)}>
                <h1 className="truncate type-title-3 text-ink">{title}</h1>
                {subtitle ? <p className="-mt-0.5 truncate type-caption text-ink-3">{subtitle}</p> : null}
              </div>
              <div className="flex shrink-0 items-center">{actions}</div>
            </>
          )}
        </div>
      </div>
      {large ? (
        <div ref={largeTitle} className="shrink-0 px-4 pt-1 pb-3">
          <h1 className="type-title-1 text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 type-footnote text-ink-3">{subtitle}</p> : null}
        </div>
      ) : null}
      {below ? (
        <div className="sticky z-(--z-sticky) w-full shrink-0 bg-canvas px-4 pt-1 pb-3" style={{ top: BAR_HEIGHT }}>
          {below}
        </div>
      ) : null}
    </>
  );
});

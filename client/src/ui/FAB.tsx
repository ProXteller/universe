import { forwardRef, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { duration, ease, spring, useReducedMotionPref } from '@/lib/motion';
import { useNavVisibility } from './navVisibility';
import { useScreen } from './Screen';

export interface FABProps {
  icon: LucideIcon;
  /** Accessible name; also the visible label of the `extended` pill. */
  label: string;
  /** 52px pill with label; collapses to the round 56px button after the list scrolls 80px. */
  extended?: boolean;
  onClick(): void;
  /** Scroll container to watch: hides while scrolling down, returns on scroll up. */
  hideOnScroll?: RefObject<HTMLElement | null>;
  /** Small corner glyph (Buzz: `VenetianMask` on the `PenLine` FAB). */
  badgeIcon?: LucideIcon;
  className?: string;
}

const COLLAPSE_AFTER = 80;
const DIRECTION_SLOP = 6;

/**
 * The screen's single create action. Inside a `<Screen>` it portals into the screen's non-scrolling
 * float layer, so it can be written anywhere in the screen's JSX and never scrolls away.
 */
export const FAB = forwardRef<HTMLButtonElement, FABProps>(function FAB(
  { icon: Icon, label, extended = false, onClick, hideOnScroll, badgeIcon: BadgeIcon, className },
  ref,
) {
  const screen = useScreen();
  const navVisible = useNavVisibility();
  const reduced = useReducedMotionPref();
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    const el = hideOnScroll?.current ?? null;
    if (!el) return;
    last.current = el.scrollTop;
    const onScroll = () => {
      const y = el.scrollTop;
      const dy = y - last.current;
      setCollapsed(y > COLLAPSE_AFTER);
      if (y <= 0) setHidden(false);
      else if (dy > DIRECTION_SLOP) setHidden(true);
      else if (dy < -DIRECTION_SLOP) setHidden(false);
      if (Math.abs(dy) > DIRECTION_SLOP) last.current = y;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hideOnScroll]);

  const showLabel = extended && !collapsed;
  const inNav = screen ? screen.nav : navVisible;

  const node = (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      onClick={onClick}
      tabIndex={hidden ? -1 : 0}
      initial={false}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      animate={reduced ? { opacity: hidden ? 0 : 1, y: 0 } : { y: hidden ? 96 : 0, opacity: 1 }}
      transition={reduced ? { duration: duration.fast, ease: ease.out } : spring.smooth}
      style={{ bottom: inNav ? 'calc(var(--nav-clearance) + 4px)' : 'calc(16px + var(--safe-bottom))' }}
      className={cn(
        'pointer-events-auto absolute right-4 z-(--z-fab) inline-flex h-14 min-w-14 items-center justify-center rounded-full',
        'bg-hero text-on-accent shadow-glow transition-[filter] duration-150 ease-out select-none hover:brightness-110 active:brightness-95',
        showLabel && 'h-13 gap-2 pr-5 pl-4',
        hidden && 'pointer-events-none',
        className,
      )}
    >
      <span className={cn('relative inline-flex', BadgeIcon && showLabel && 'mr-2')}>
        <Icon size={24} strokeWidth={2} aria-hidden />
        {BadgeIcon ? (
          <span className="absolute -right-2.5 -bottom-2 flex size-[18px] items-center justify-center rounded-full bg-on-accent text-accent ring-2 ring-accent">
            <BadgeIcon size={11} strokeWidth={2.25} aria-hidden />
          </span>
        ) : null}
      </span>
      {showLabel ? <span className="type-label whitespace-nowrap">{label}</span> : null}
    </motion.button>
  );

  return screen?.floatEl ? createPortal(node, screen.floatEl) : screen ? null : node;
});

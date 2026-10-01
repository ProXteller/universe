/**
 * Floating six-item bottom navigation (design §6.3). The active item expands into a pill whose background is a
 * shared `layoutId` element; three stacked pill layers (Aurora / Phosphor / neutral-over-video) crossfade with
 * the Home pager `progress`, so the pill is Phosphor only while Home rests on Buzz. Nav visibility comes from
 * `<Screen nav>` (`useNavVisible`); hidden = slides out `y: 96`.
 */
import { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { LayoutGroup, motion, useTransform } from 'motion/react';
import { BedDouble, Building2, House, MessageCircle, Search, Store, type LucideIcon } from 'lucide-react';
import { Badge } from '@/ui';
import { cn } from '@/lib/cn';
import { useLocalStorage } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { duration, reducedTween, spring, useReducedMotionPref } from '@/lib/motion';
import { useBadges } from '@/lib/session';
import { homeMounted, homeProgress, useHomeStore } from '@/stores/home';
import { useNavVisible } from '@/stores/ui';

interface NavItem {
  key: 'home' | 'discover' | 'messages' | 'roommates' | 'market' | 'apartments';
  label: string;
  icon: LucideIcon;
  /** Path prefix that marks the item active. */
  match: string;
}

const ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: House, match: '/home' },
  { key: 'discover', label: 'Discover', icon: Search, match: '/discover' },
  { key: 'messages', label: 'Messages', icon: MessageCircle, match: '/messages' },
  { key: 'roommates', label: 'Roommates', icon: BedDouble, match: '/roommates' },
  { key: 'market', label: 'Market', icon: Store, match: '/market' },
  { key: 'apartments', label: 'Apartments', icon: Building2, match: '/apartments' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Scrolls the current route's `<Screen>` scroller to the top (re-tap of the active nav item). */
function scrollScreenToTop(smooth: boolean): void {
  const el = document.querySelector<HTMLElement>('#screen-root [data-screen-scroll]');
  el?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
}

function Pill() {
  const publicOpacity = useTransform([homeProgress, homeMounted], ([p, m]: number[]) => (m ? clamp01((p ?? 0) - 1) : 1));
  const incogOpacity = useTransform([homeProgress, homeMounted], ([p, m]: number[]) => (m ?? 0) * clamp01(1 - Math.abs((p ?? 0) - 1)));
  const reelsOpacity = useTransform([homeProgress, homeMounted], ([p, m]: number[]) => (m ?? 0) * clamp01(1 - (p ?? 0)));
  return (
    <>
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-accent-soft" style={{ opacity: publicOpacity }} />
      {/* Phosphor pill (= incognito `--color-accent-soft`); the nav sits outside the Buzz surface, so it is built from the token here. */}
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-incog-500/13" style={{ opacity: incogOpacity }} />
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-white/14" style={{ opacity: reelsOpacity }} />
    </>
  );
}

export function BottomNav() {
  const visible = useNavVisible();
  const reduced = useReducedMotionPref();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const badges = useBadges();
  const lastTab = useHomeStore((s) => s.tab);
  const bumpScrollTop = useHomeStore((s) => s.bumpScrollTop);
  const [apartmentsSeen, setApartmentsSeen] = useLocalStorage<boolean>('uv:nav:apartments-seen', false);

  const isHome = pathname.startsWith('/home');
  useEffect(() => {
    if (pathname.startsWith('/apartments') && !apartmentsSeen) setApartmentsSeen(true);
  }, [pathname, apartmentsSeen, setApartmentsSeen]);

  // Over Reels the glass darkens to neutral black (video underneath).
  const reelsShade = useTransform([homeProgress, homeMounted], ([p, m]: number[]) => (m ?? 0) * clamp01(1 - (p ?? 0)));
  const [surface, setSurface] = useState<'public' | 'incognito'>('public');
  useEffect(() => {
    setSurface(isHome && lastTab === 'buzz' ? 'incognito' : 'public');
  }, [isHome, lastTab]);

  const hrefFor = useCallback(
    (item: NavItem) => {
      switch (item.key) {
        case 'home':
          return routes.home(lastTab);
        case 'discover':
          return routes.discover();
        case 'messages':
          return routes.messages();
        case 'roommates':
          return routes.roommates();
        case 'market':
          return routes.market();
        case 'apartments':
          return routes.apartments();
      }
    },
    [lastTab],
  );

  const isActive = (item: NavItem) => pathname === item.match || pathname.startsWith(`${item.match}/`);
  const active = ITEMS.find(isActive)?.key ?? null;

  return (
    <motion.nav
      aria-label="Primary"
      data-surface={surface}
      initial={false}
      animate={{ y: visible ? 0 : 96 }}
      transition={reduced ? reducedTween : spring.smooth}
      className="absolute inset-x-2 z-(--z-nav) flex h-16 items-center justify-between rounded-full p-1"
      style={{ bottom: 'calc(var(--nav-gap) + var(--safe-bottom))', backgroundColor: 'transparent', pointerEvents: visible ? 'auto' : 'none' }}
      aria-hidden={!visible}
    >
      <span aria-hidden className="glass absolute inset-0 rounded-full" />
      <motion.span aria-hidden className="absolute inset-0 rounded-full bg-black/45" style={{ opacity: reelsShade }} />
      <LayoutGroup id="bottom-nav">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const on = active === item.key;
          const badge =
            item.key === 'messages'
              ? badges.messages > 0
                ? badges.messages
                : badges.requests > 0
                  ? 'dot'
                  : undefined
              : item.key === 'apartments' && !apartmentsSeen
                ? 'dot'
                : undefined;
          return (
            <motion.div key={item.key} layout={reduced ? false : 'position'} transition={spring.snappy} className="relative flex shrink-0 items-center justify-center">
              <NavLink
                to={hrefFor(item)}
                aria-label={item.label}
                aria-current={on ? 'page' : undefined}
                draggable={false}
                onClick={(e) => {
                  if (!on) return;
                  e.preventDefault();
                  if (item.key === 'home') {
                    if (pathname !== routes.home(lastTab)) navigate(routes.home(lastTab), { replace: true });
                    bumpScrollTop();
                  } else {
                    if (pathname !== item.match) navigate(item.match, { replace: true });
                    scrollScreenToTop(!reduced);
                  }
                }}
                className={cn(
                  'press-icon relative flex items-center justify-center gap-1.5 rounded-full select-none',
                  on ? 'h-12 min-w-24 max-w-[132px] pr-3.5 pl-3 text-ink' : 'h-14 w-11 text-ink-3 active:text-ink',
                )}
              >
                {on ? (
                  <motion.span
                    layoutId="nav-pill"
                    aria-hidden
                    className="absolute inset-0 rounded-full"
                    transition={reduced ? reducedTween : spring.snappy}
                  >
                    <Pill />
                  </motion.span>
                ) : null}
                <span className="relative flex shrink-0 items-center justify-center">
                  <Icon size={22} strokeWidth={on ? 2.25 : 1.75} aria-hidden />
                  {badge === 'dot' ? (
                    <Badge variant="dot" className="absolute -top-0.5 -right-0.5 ring-2 ring-canvas" />
                  ) : typeof badge === 'number' ? (
                    <Badge variant="count" count={badge} className="absolute -top-2 -right-3 ring-2 ring-canvas" />
                  ) : null}
                </span>
                {on ? (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1, transition: { duration: duration.fast, delay: 0.04 } }}
                    className="relative truncate type-caption font-semibold @max-[372px]/frame:text-[11px]"
                  >
                    {item.label}
                  </motion.span>
                ) : (
                  <span className="sr-only">{item.label}</span>
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </LayoutGroup>
    </motion.nav>
  );
}

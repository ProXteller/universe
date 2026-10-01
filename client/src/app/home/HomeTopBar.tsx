/**
 * Home top bar (design §6.4 + SPEC §1.2). Overlays all three panes; never hides on scroll.
 *
 *  Left   the identity-aware Me button: the viewer `Avatar` (ring="orbit") crossfades with a neutral `CircleUser`
 *         glyph as the pager approaches Buzz — `avatarOpacity = clamp(|progress − 1|, 0, 1)`. The layer at
 *         opacity 0 is unmounted (stronger than `visibility:hidden` + `aria-hidden`): at rest on Buzz nothing
 *         inside `#frame` shows the viewer's avatar, name or handle. Both layers open the Me sheet.
 *  Centre tablist Reels · Buzz · Orbit with the scroll-linked indicator (x, liquid width, white → lime → violet).
 *  Right  bell with the unread badge → Notifications.
 *
 * Everything is glued to `homeProgress` through `useTransform` — no spring, no React state on the scroll path.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent, useTransform, type MotionStyle } from 'motion/react';
import { Bell, CircleUser, VenetianMask } from 'lucide-react';
import { HOME_TABS, type HomeTab } from '@shared/core';
import { IconButton } from '@/ui';
import { UserAvatar } from '@/components';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';
import { useBadges, useMeOptional } from '@/lib/session';
import { useHomeStore, useHomeTab } from '@/stores/home';
import { useUiStore } from '@/stores/ui';

const LABEL: Record<HomeTab, string> = { reels: 'Reels', buzz: 'Buzz', orbit: 'Orbit' };
const INDICATOR = { rest: 20, stretch: 32, height: 3 };
const HIDE_EPSILON = 0.01;
/**
 * Indicator colour white → lime → violet along the pager, mixed in CSS from the theme tokens (motion cannot
 * interpolate `var()`, and the tokens must stay the single source of truth). `--home-p` (0..2) is written by
 * motion on every scroll frame; the inner mix covers Reels → Buzz, the outer one Buzz → Orbit.
 */
const INDICATOR_COLOR =
  'color-mix(in oklab, var(--color-brand-500) calc(clamp(0, var(--home-p, 0) - 1, 1) * 100%), ' +
  'color-mix(in oklab, var(--color-incog-500) calc(clamp(0, var(--home-p, 0), 1) * 100%), var(--color-white)))';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Piecewise-linear interpolation over `[0, 0.5, 1, 1.5, 2] → [20, 32, 20, 32, 20]`: a liquid stretch at the midpoints. */
function indicatorWidth(p: number): number {
  const f = clamp(p, 0, 2) % 1;
  const t = f <= 0.5 ? f / 0.5 : (1 - f) / 0.5;
  return lerp(INDICATOR.rest, INDICATOR.stretch, t);
}

function TabLabel({ tab, index, active, onSelect, refCb }: { tab: HomeTab; index: number; active: boolean; onSelect(): void; refCb(el: HTMLButtonElement | null): void }) {
  const { progress } = useHomeTab();
  const opacity = useTransform(progress, [index - 1, index, index + 1], [0.55, 1, 0.55]);
  const maskOpacity = useTransform(progress, [0, 1, 2], [0, 1, 0]);
  return (
    <motion.button
      ref={refCb}
      type="button"
      role="tab"
      id={`home-tab-${tab}`}
      aria-selected={active}
      aria-controls={`home-pane-${tab}`}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      style={{ opacity }}
      className="press relative flex h-11 shrink-0 items-center gap-1 rounded-sm px-0.5 font-display text-md font-semibold text-ink select-none"
    >
      {tab === 'buzz' ? (
        <motion.span aria-hidden style={{ opacity: maskOpacity }} className="flex items-center text-incog-500">
          <VenetianMask size={12} strokeWidth={2.25} />
        </motion.span>
      ) : null}
      {LABEL[tab]}
    </motion.button>
  );
}

export function HomeTopBar() {
  const me = useMeOptional();
  const badges = useBadges();
  const { tab, setTab, progress } = useHomeTab();
  const bumpScrollTop = useHomeStore((s) => s.bumpScrollTop);
  const setMeSheetOpen = useUiStore((s) => s.setMeSheetOpen);

  /* ---- measured label centres (ResizeObserver) ---- */
  const listRef = useRef<HTMLDivElement | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const c0 = useMotionValue(0);
  const c1 = useMotionValue(0);
  const c2 = useMotionValue(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const measure = () => {
      const centers = [c0, c1, c2];
      buttons.current.forEach((b, i) => {
        if (b) centers[i]?.set(b.offsetLeft + b.offsetWidth / 2);
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    buttons.current.forEach((b) => b && ro.observe(b));
    return () => ro.disconnect();
  }, [c0, c1, c2]);

  /* ---- scroll-linked styles ---- */
  const width = useTransform(progress, (p) => indicatorWidth(p));
  const x = useTransform(() => {
    const p = clamp(progress.get(), 0, 2);
    const center = p <= 1 ? lerp(c0.get(), c1.get(), p) : lerp(c1.get(), c2.get(), p - 1);
    return center - indicatorWidth(p) / 2;
  });
  const scrimOpacity = useTransform(progress, [0, 1], [1, 0]);
  const incogGlass = useTransform(progress, [0, 1, 2], [0, 1, 0]);
  const publicGlass = useTransform(progress, [0, 1, 2], [0, 0, 1]);
  const textShadow = useTransform(progress, [0, 1], ['0 1px 2px rgb(0 0 0 / 0.4)', '0 1px 2px rgb(0 0 0 / 0)']);
  const iconShadow = useTransform(progress, [0, 1], ['drop-shadow(0 1px 1px rgb(0 0 0 / 0.4))', 'drop-shadow(0 1px 1px rgb(0 0 0 / 0))']);

  const avatarOpacity = useTransform(progress, (p) => clamp(Math.abs(p - 1), 0, 1));
  const glyphOpacity = useTransform(avatarOpacity, (v) => 1 - v);
  const [avatarHidden, setAvatarHidden] = useState(() => avatarOpacity.get() <= HIDE_EPSILON);
  const [glyphHidden, setGlyphHidden] = useState(() => avatarOpacity.get() >= 1 - HIDE_EPSILON);
  useMotionValueEvent(avatarOpacity, 'change', (v) => {
    setAvatarHidden(v <= HIDE_EPSILON);
    setGlyphHidden(v >= 1 - HIDE_EPSILON);
  });
  useEffect(() => {
    const v = avatarOpacity.get();
    setAvatarHidden(v <= HIDE_EPSILON);
    setGlyphHidden(v >= 1 - HIDE_EPSILON);
  }, [avatarOpacity]);

  const openMe = () => setMeSheetOpen(true);

  return (
    <div
      data-home-topbar
      className="absolute inset-x-0 top-0 z-(--z-topbar)"
      style={{ height: 'calc(var(--topbar-h) + var(--safe-top))' }}
    >
      {/* background layers */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[120px] bg-scrim-top" style={{ opacity: scrimOpacity }} />
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 border-b border-line-subtle bg-glass backdrop-blur-xl" style={{ opacity: publicGlass }} />
      <motion.div aria-hidden data-surface="incognito" className="pointer-events-none absolute inset-0" style={{ opacity: incogGlass, backgroundColor: 'transparent' }}>
        <div className="absolute inset-0 border-b border-line-subtle bg-glass backdrop-blur-xl" />
      </motion.div>

      {/* foreground */}
      <div className="absolute inset-x-0 bottom-0 flex h-(--topbar-h) items-center px-2">
        <motion.div className="relative flex size-11 shrink-0 items-center justify-center" style={{ filter: iconShadow }}>
          {!avatarHidden && me ? (
            <motion.button
              type="button"
              aria-label="Me"
              onClick={openMe}
              style={{ opacity: avatarOpacity }}
              className="press-icon absolute inset-0 flex items-center justify-center rounded-full"
              data-me-avatar
            >
              <UserAvatar user={me} size="sm" ring="orbit" link={false} />
            </motion.button>
          ) : null}
          {!glyphHidden ? (
            <motion.span style={{ opacity: glyphOpacity }} className="absolute inset-0" data-me-glyph>
              <IconButton icon={CircleUser} aria-label="Me" onClick={openMe} className="text-ink hover:bg-white/10" />
            </motion.span>
          ) : null}
        </motion.div>

        <motion.div
          ref={listRef}
          role="tablist"
          aria-label="Home"
          className="relative mx-auto flex items-center gap-5"
          style={{ textShadow }}
        >
          {HOME_TABS.map((t, i) => (
            <TabLabel
              key={t}
              tab={t}
              index={i}
              active={tab === t}
              refCb={(el) => {
                buttons.current[i] = el;
              }}
              onSelect={() => (tab === t ? bumpScrollTop() : setTab(t))}
            />
          ))}
          <motion.span
            aria-hidden
            className={cn('pointer-events-none absolute left-0 rounded-full')}
            // Motion writes custom properties from `style` (`setProperty`); its `MotionStyle` type just does not list them.
            style={{ top: 'calc(50% + 17px)', height: INDICATOR.height, x, width, backgroundColor: INDICATOR_COLOR, '--home-p': progress } as MotionStyle}
          />
        </motion.div>

        <motion.div className="flex size-11 shrink-0 items-center justify-center" style={{ filter: iconShadow }}>
          <IconButton
            icon={Bell}
            aria-label="Notifications"
            badge={badges.notifications}
            to={routes.notifications()}
            className="text-ink hover:bg-white/10"
          />
        </motion.div>
      </div>
    </div>
  );
}

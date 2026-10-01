import { forwardRef, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { CircleAlert, CircleCheck, Info, Mail } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { exitTween, reducedTween, spring, useReducedMotionPref } from '@/lib/motion';
import { OverlayPortal } from './overlay';
import type { SurfaceMode } from './Surface';
import { useToastStore, type ToastItem, type ToastTone } from './toast';

export interface ToasterProps {
  /**
   * Colour world for the toast chrome (action label, focus ring). The shell passes `'incognito'` while the
   * Buzz pane is active so no violet shows up there. Default: inherited Surface mode.
   */
  mode?: SurfaceMode;
  className?: string;
}

const toneIcon: Record<ToastTone, LucideIcon | null> = { success: CircleCheck, error: CircleAlert, info: Info, neutral: null };
const toneColor: Record<ToastTone, string> = { success: 'text-success', error: 'text-danger', info: 'text-info', neutral: 'text-ink-2' };

/* Only the first mounted Toaster paints, so a second one (dev gallery inside the shell) never doubles toasts. */
const owners: symbol[] = [];
const ownerListeners = new Set<() => void>();

function useIsPrimaryToaster(): boolean {
  const [token] = useState(() => Symbol('toaster'));
  const [primary, setPrimary] = useState(false);
  useEffect(() => {
    const update = () => setPrimary(owners[0] === token);
    owners.push(token);
    ownerListeners.add(update);
    ownerListeners.forEach((fn) => fn());
    return () => {
      owners.splice(owners.indexOf(token), 1);
      ownerListeners.delete(update);
      ownerListeners.forEach((fn) => fn());
    };
  }, [token]);
  return primary;
}

/** Mount once in the shell. Top-centre under the safe area (the bottom belongs to the nav). */
export const Toaster = forwardRef<HTMLDivElement, ToasterProps>(function Toaster({ mode, className }, ref) {
  const toasts = useToastStore((s) => s.toasts);
  const primary = useIsPrimaryToaster();
  if (!primary) return null;
  return (
    <OverlayPortal mode={mode}>
      <div
        ref={ref}
        className={cn('pointer-events-none absolute inset-x-0 top-0 z-(--z-toast) flex flex-col items-center gap-2 px-4', className)}
        style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} item={t} />
          ))}
        </AnimatePresence>
      </div>
    </OverlayPortal>
  );
});

function ToastCard({ item }: { item: ToastItem }) {
  const reduced = useReducedMotionPref();
  const dismiss = useToastStore((s) => s.dismiss);
  const remaining = useRef(item.duration);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const start = () => {
    window.clearTimeout(timer.current);
    startedAt.current = performance.now();
    timer.current = window.setTimeout(() => dismiss(item.id), Math.max(800, remaining.current));
  };
  const pause = () => {
    window.clearTimeout(timer.current);
    remaining.current -= performance.now() - startedAt.current;
  };

  useEffect(() => {
    start();
    return () => window.clearTimeout(timer.current);
    // One timer per toast instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -24 || info.velocity.y < -300) dismiss(item.id);
    else start();
  };

  const devInbox = item.kind === 'dev-inbox';
  const Icon = devInbox ? Mail : toneIcon[item.tone];

  return (
    <motion.div
      layout={reduced ? false : 'position'}
      role={item.tone === 'error' ? 'alert' : 'status'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: -16 }}
      animate={reduced ? { opacity: 1, transition: reducedTween } : { opacity: 1, y: 0, transition: spring.smooth }}
      exit={{ opacity: 0, transition: exitTween }}
      drag={reduced ? false : 'y'}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.7, bottom: 0.05 }}
      dragSnapToOrigin
      onDragStart={pause}
      onDragEnd={onDragEnd}
      onPointerEnter={pause}
      onPointerLeave={start}
      className="glass pointer-events-auto flex w-full max-w-[398px] touch-none items-center gap-3 rounded-lg px-4 py-3 text-ink select-none"
    >
      {Icon ? <Icon size={20} strokeWidth={1.75} aria-hidden className={cn('shrink-0', toneColor[item.tone])} /> : null}
      {devInbox ? (
        <div className="min-w-0 flex-1">
          <div className="type-overline text-ink-3">Dev inbox · your code</div>
          <div className="font-mono text-xl font-semibold tracking-[0.2em] text-ink tabular-nums">{item.message}</div>
        </div>
      ) : (
        <p className="line-clamp-2 min-w-0 flex-1 type-footnote text-ink">{item.message}</p>
      )}
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onClick();
            dismiss(item.id);
          }}
          className="press relative -my-1 -mr-1 shrink-0 rounded-full px-3 py-2 type-label-sm text-accent-ink before:absolute before:-inset-1 hover:bg-accent-soft"
        >
          {item.action.label}
        </button>
      ) : null}
    </motion.div>
  );
}

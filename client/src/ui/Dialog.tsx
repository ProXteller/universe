import { forwardRef, useEffect, useId, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { duration, ease, exitTween, reducedTween, spring, useReducedMotionPref } from '@/lib/motion';
import { Button } from './Button';
import { OverlayPortal, useEscapeKey, useFocusTrap, useKeyboardInset, useMergedRef, useOverlayLayer } from './overlay';

export interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: ReactNode;
  /** 48px tone disc above the title. */
  icon?: LucideIcon;
  tone?: 'default' | 'danger';
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /**
   * Runs on confirm. If it returns a promise the confirm button shows its loading state until it settles;
   * the dialog closes itself when it resolves and stays open when it rejects (the caller toasts the error).
   */
  onConfirm(): void | Promise<void>;
  confirmDisabled?: boolean;
  /** Scrim tap and Esc do not close. */
  persistent?: boolean;
  /** Extra content between the description and the actions (e.g. the unmask reason field). */
  children?: ReactNode;
  className?: string;
}

/** Which vertical edges of the dialog body hide content — drives the header / actions hairlines. */
function useVerticalEdges(ref: RefObject<HTMLElement | null>, enabled: boolean): { top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const update = () => {
      const top = el.scrollTop > 2;
      const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
      setEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [ref, enabled]);
  return edges;
}

/** Interrupting decisions only (confirm delete, block, unmask-with-reason, leave without saving). */
export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(props, ref) {
  return (
    <OverlayPortal>
      <AnimatePresence>{props.open ? <DialogPanel key="dialog" {...props} panelRef={ref} /> : null}</AnimatePresence>
    </OverlayPortal>
  );
});

function DialogPanel({
  onOpenChange,
  title,
  description,
  icon: Icon,
  tone = 'default',
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  confirmDisabled,
  persistent = false,
  children,
  className,
  panelRef,
}: DialogProps & { panelRef: Ref<HTMLDivElement> }) {
  const reduced = useReducedMotionPref();
  const present = useIsPresent();
  const isTop = useOverlayLayer(present);
  const panel = useRef<HTMLDivElement | null>(null);
  const setPanel = useMergedRef(panelRef, panel);
  const titleId = useId();
  const descId = useId();
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const cancel = () => {
    if (!busy) onOpenChange(false);
  };
  useEscapeKey(present && !persistent, isTop, cancel);
  useFocusTrap(panel, present, isTop);

  const confirm = async () => {
    if (busy || confirmDisabled) return;
    try {
      const result = onConfirm();
      if (result instanceof Promise) {
        setBusy(true);
        await result;
      }
      if (alive.current) onOpenChange(false);
    } catch {
      /* stay open; the caller reports the failure */
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const sideBySide = confirmLabel.length <= 8 && cancelLabel.length <= 8;
  const danger = tone === 'danger';
  const hasBody = Boolean(description || children);
  const keyboard = useKeyboardInset(present);
  const body = useRef<HTMLDivElement | null>(null);
  const edges = useVerticalEdges(body, hasBody);

  return (
    <div
      // Padding keeps the panel off the frame edges / safe areas; the panel's `max-h-full` resolves against it.
      className="absolute inset-x-0 top-0 z-(--z-dialog) flex items-center justify-center px-6 pt-[calc(var(--safe-top)+24px)] pb-[calc(var(--safe-bottom)+24px)]"
      style={{ bottom: keyboard, pointerEvents: present ? 'auto' : 'none' }}
    >
      <motion.div
        aria-hidden
        onClick={persistent ? undefined : cancel}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: reduced ? reducedTween.duration : duration.base, ease: ease.out } }}
        exit={{ opacity: 0, transition: exitTween }}
        className="absolute inset-0 bg-scrim backdrop-blur-[6px]"
      />
      <motion.div
        ref={setPanel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 }}
        animate={reduced ? { opacity: 1, transition: reducedTween } : { opacity: 1, scale: 1, y: 0, transition: spring.smooth }}
        exit={{ opacity: 0, transition: exitTween }}
        // Capped at the frame: icon + title and the actions stay pinned, only the body scrolls. (The panel itself
        // scrolls only as a last resort, when even header + actions are taller than the frame.)
        className={cn(
          'relative flex max-h-full w-full max-w-[340px] flex-col overflow-y-auto overscroll-contain rounded-lg',
          'border border-line bg-surface-3 text-ink shadow-lg inset-shadow-hairline outline-none',
          className,
        )}
      >
        <div
          className={cn(
            'flex shrink-0 flex-col border-b px-6 pt-6 pb-2 transition-colors duration-150',
            edges.top ? 'border-line-subtle' : 'border-transparent',
          )}
        >
          {Icon ? (
            <div
              aria-hidden
              className={cn(
                'mb-4 flex size-12 shrink-0 items-center justify-center self-center rounded-full',
                danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-ink',
              )}
            >
              <Icon size={24} strokeWidth={1.75} />
            </div>
          ) : null}
          <h2 id={titleId} className={cn('type-title-3 text-ink', Icon && 'text-center')}>
            {title}
          </h2>
        </div>
        {hasBody ? (
          <div ref={body} className={cn('min-h-0 overflow-y-auto overscroll-contain px-6 pb-3', !description && 'pt-2')}>
            {description ? (
              <div id={descId} className={cn('type-body text-ink-2', Icon && 'text-center')}>
                {description}
              </div>
            ) : null}
            {children ? <div className={description ? 'mt-4' : undefined}>{children}</div> : null}
          </div>
        ) : null}
        <div
          className={cn(
            'flex shrink-0 gap-2 border-t px-6 pb-6 transition-colors duration-150',
            hasBody ? 'pt-3' : 'pt-3.5',
            edges.bottom ? 'border-line-subtle' : 'border-transparent',
            sideBySide ? 'flex-row-reverse' : 'flex-col',
          )}
        >
          <Button
            variant={danger ? 'danger' : 'primary'}
            fullWidth
            loading={busy}
            disabled={confirmDisabled}
            onClick={confirm}
            className={sideBySide ? 'flex-1' : undefined}
          >
            {confirmLabel}
          </Button>
          <Button variant="ghost" fullWidth disabled={busy} onClick={cancel} className={sideBySide ? 'flex-1' : undefined}>
            {cancelLabel}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

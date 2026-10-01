/**
 * Internal overlay plumbing shared by Sheet, Dialog, Lightbox and Toaster. Not part of the public barrel
 * except `OverlayPortal` (hosts in `components/` may need it).
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { SurfaceContext, useSurfaceMode, type SurfaceMode } from './Surface';

/* ------------------------------------------------------------------ overlay root */

/**
 * `#overlay-root` is rendered by AppShell inside `#frame`. If it is missing (kit gallery rendered on its
 * own, tests) one is created inside `#frame`, or as a last resort inside <body>, with the same rules.
 */
export function getOverlayRoot(): HTMLElement {
  const existing = document.getElementById('overlay-root');
  if (existing) return existing;
  const host = document.getElementById('frame') ?? document.body;
  const el = document.createElement('div');
  el.id = 'overlay-root';
  // Same declarations as base.css, inline so the fallback also works without the stylesheet.
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.pointerEvents = 'none';
  host.appendChild(el);
  return el;
}

export interface OverlayPortalProps {
  children: ReactNode;
  /** Override the inherited surface mode (hosts that capture the caller's mode at call time). */
  mode?: SurfaceMode;
}

/**
 * Portals children into `#overlay-root` and re-stamps the surface mode on a `display: contents` wrapper
 * (so the incognito rule's `background-color` never paints a full-frame box).
 */
export function OverlayPortal({ children, mode }: OverlayPortalProps) {
  const inherited = useSurfaceMode();
  const resolved = mode ?? inherited;
  const [root, setRoot] = useState<HTMLElement | null>(null);

  // Resolved after commit so an `#overlay-root` mounted in the same pass (AppShell) is found.
  useLayoutEffect(() => {
    setRoot(getOverlayRoot());
  }, []);

  if (!root) return null;
  return createPortal(
    <SurfaceContext.Provider value={resolved}>
      <div data-surface={resolved} style={{ display: 'contents' }}>
        {children}
      </div>
    </SurfaceContext.Provider>,
    root,
  );
}

/* ------------------------------------------------------------------ layer stack (topmost wins Esc / Tab) */

const stack: string[] = [];

/** Registers an open overlay; returns `isTop()` so only the topmost layer reacts to Esc and traps Tab. */
export function useOverlayLayer(active: boolean): () => boolean {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    stack.push(id);
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active, id]);
  return () => stack[stack.length - 1] === id;
}

/** Esc closes the topmost overlay only. */
export function useEscapeKey(active: boolean, isTop: () => boolean, onEscape: () => void): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  const top = useRef(isTop);
  top.current = isTop;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !top.current()) return;
      e.preventDefault();
      handler.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);
}

/* ------------------------------------------------------------------ focus trap */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => !n.hasAttribute('aria-hidden') && (n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement),
  );
}

/**
 * Traps Tab inside `ref` while active, focuses the container on activation (never an input: that would
 * pop the keyboard on phones — callers that want it use `autoFocus`), and returns focus to the trigger.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean, isTop: () => boolean): void {
  const top = useRef(isTop);
  top.current = isTop;
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !top.current()) return;
      const nodes = focusables(el);
      if (nodes.length === 0) {
        e.preventDefault();
        el.focus({ preventScroll: true });
        return;
      }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const current = document.activeElement;
      if (!el.contains(current)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (current === first || current === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

/* ------------------------------------------------------------------ on-screen keyboard inset */

/**
 * Pixels of the frame covered by the on-screen keyboard (iOS keeps the layout viewport and only shrinks
 * `visualViewport`). Sheets lift by this amount; `Screen` lifts its sticky footer.
 */
export function useKeyboardInset(active: boolean): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (!active) {
      setInset(0);
      return;
    }
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const frame = document.getElementById('frame');
      const bottom = frame ? frame.getBoundingClientRect().bottom : window.innerHeight;
      const covered = Math.round(bottom - (vv.offsetTop + vv.height));
      // Browser toolbars move the viewport by a few dozen px; a keyboard is always taller than that.
      setInset(covered > 80 ? covered : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);
  return inset;
}

/* ------------------------------------------------------------------ misc */

/** Assigns a node to any mix of object / callback refs. */
export function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as MutableRefObject<T | null>).current = value;
}

export function useMergedRef<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  const latest = useRef(refs);
  latest.current = refs;
  return useRef((node: T | null) => {
    latest.current.forEach((r) => assignRef(r, node));
  }).current;
}

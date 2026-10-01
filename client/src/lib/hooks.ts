/**
 * Small shared hooks (SPEC §4.4.1 `lib/hooks.ts`).
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function readLocal<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return initial;
    return JSON.parse(raw) as T;
  } catch {
    return initial;
  }
}

/**
 * `localStorage`-backed state. Keys MUST be prefixed `uv:<slice>:` (warned in dev). **Buzz MUST NOT use it**
 * (firewall §3.2 #5). Storage failures (private mode) degrade to plain state.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  if (import.meta.env.DEV && !key.startsWith('uv:')) {
    console.warn(`useLocalStorage: key "${key}" should be prefixed "uv:<slice>:"`);
  }
  const [value, setValue] = useState<T>(() => readLocal(key, initial));
  const set = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [key],
  );
  return [value, set];
}

/** `true` while `ref` intersects its root (default: viewport). */
export function useIntersection(ref: RefObject<Element | null>, opts?: IntersectionObserverInit): boolean {
  const [visible, setVisible] = useState(false);
  const root = opts?.root;
  const rootMargin = opts?.rootMargin;
  const threshold = opts?.threshold;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setVisible(entry.isIntersecting);
      },
      { root: root ?? null, rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, root, rootMargin, Array.isArray(threshold) ? threshold.join(',') : threshold]);
  return visible;
}

/**
 * Single vs double tap on one element: returns an `onClick` handler. The single action is delayed by `ms`
 * so a double tap can cancel it (like-burst on reels / photos).
 */
export function useDoubleTap<E = Element>(
  onSingle: ((e: React.MouseEvent<E>) => void) | undefined,
  onDouble: (e: React.MouseEvent<E>) => void,
  ms = 250,
): (e: React.MouseEvent<E>) => void {
  const timer = useRef<number | null>(null);
  const single = useRef(onSingle);
  const dbl = useRef(onDouble);
  single.current = onSingle;
  dbl.current = onDouble;
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (e: React.MouseEvent<E>) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
        dbl.current(e);
        return;
      }
      e.persist?.();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        single.current?.(e);
      }, ms);
    },
    [ms],
  );
}

/** `true` while the scroller is at (or within 8px of) its top — drives "New posts" pills and glass headers. */
export function useOnScreenTop(scrollRef: RefObject<HTMLElement | null>, threshold = 8): boolean {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setAtTop(el.scrollTop <= threshold);
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [scrollRef, threshold]);
  return atTop;
}

/** Latest-value ref (for event handlers that must not re-subscribe on every render). */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Matches a media query reactively (`useMediaQuery('(min-width: 768px)')`). */
export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

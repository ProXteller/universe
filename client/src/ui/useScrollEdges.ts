import { useEffect, useState, type CSSProperties, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is hidden past the left edge. */
  start: boolean;
  /** Content is hidden past the right edge. */
  end: boolean;
}

/** Tracks which horizontal edges of a scroller hide content, so fade masks appear only where needed. */
export function useScrollEdges(ref: RefObject<HTMLElement | null>, enabled = true): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const update = () => {
      const start = el.scrollLeft > 2;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
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

/** Inline mask for the edges that hide content (24px fades). */
export function edgeMaskStyle({ start, end }: ScrollEdges): CSSProperties | undefined {
  if (!start && !end) return undefined;
  const image = `linear-gradient(to right, ${start ? 'transparent' : 'black'} 0, black 24px, black calc(100% - 24px), ${end ? 'transparent' : 'black'} 100%)`;
  return { maskImage: image, WebkitMaskImage: image };
}

import { createContext, forwardRef, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type SurfaceMode = 'public' | 'incognito';

/**
 * The current colour world. Portaled overlays (Sheet, Dialog, Lightbox) read it and stamp the same
 * `data-surface` on their portal container, so a sheet opened from Buzz is Phosphor even though it
 * renders in `#overlay-root`.
 */
export const SurfaceContext = createContext<SurfaceMode>('public');

export function useSurfaceMode(): SurfaceMode {
  return useContext(SurfaceContext);
}

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  mode: SurfaceMode;
  className?: string;
  children?: ReactNode;
}

/**
 * Remaps the semantic colour slots for everything inside it (theme.css `[data-surface="incognito"]`).
 * `mode="incognito"` may be mounted only by `buzz`, Buzz excerpts inside `admin`, and foundation (SPEC §2).
 *
 * Note: the incognito rule in theme.css is unlayered and paints `background-color: var(--color-canvas)`;
 * a Tailwind `bg-*` class cannot override it. Pass `style={{ backgroundColor: 'transparent' }}` if the
 * wrapper must stay see-through.
 */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { mode, className, children, ...rest },
  ref,
) {
  return (
    <SurfaceContext.Provider value={mode}>
      <div ref={ref} data-surface={mode} className={cn(className)} {...rest}>
        {children}
      </div>
    </SurfaceContext.Provider>
  );
});

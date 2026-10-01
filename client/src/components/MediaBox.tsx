import { forwardRef, useCallback, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { cn } from '@/lib/cn';

export type MediaAspect = '1:1' | '4:5' | '4:3' | '16:9' | '9:16' | number;

export interface MediaBoxProps {
  src: string | null;
  alt: string;
  aspect?: MediaAspect;
  rounded?: 'none' | 'sm' | 'md' | 'lg';
  fit?: 'cover' | 'contain';
  onClick?(): void;
  /** Rendered above the image (gradients, chips, counters). */
  overlay?: ReactNode;
  className?: string;
}

const RATIO: Record<Exclude<MediaAspect, number>, string> = { '1:1': '1 / 1', '4:5': '4 / 5', '4:3': '4 / 3', '16:9': '16 / 9', '9:16': '9 / 16' };
const ROUNDED = { none: 'rounded-none', sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg' } as const;

/** Fixed-ratio image box (design's "MediaImage"): `bg-surface-2`, lazy, fades in, error glyph. */
export const MediaBox = forwardRef<HTMLDivElement, MediaBoxProps>(function MediaBox(
  { src, alt, aspect = '1:1', rounded = 'md', fit = 'cover', onClick, overlay, className },
  ref,
) {
  // State is keyed by the src it describes, so a new src starts hidden without a reset effect. (A reset effect
  // races cached images: their `load` fires before the effect runs, the effect then clears it, and the image
  // stays at opacity-0 forever.) The ref callback also catches images that finished loading before React
  // attached `onLoad`.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const loaded = !!src && loadedSrc === src;
  const failed = !!src && failedSrc === src;
  const imgRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (el && src && el.complete && el.naturalWidth > 0) setLoadedSrc(src);
    },
    [src],
  );

  const ratio = typeof aspect === 'number' ? String(aspect) : RATIO[aspect];
  const broken = !src || failed;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      ref={ref as never}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? alt : undefined}
      style={{ aspectRatio: ratio }}
      className={cn(
        'relative block w-full overflow-hidden bg-surface-2 text-ink-4',
        ROUNDED[rounded],
        onClick && 'press cursor-pointer',
        className,
      )}
    >
      {broken ? (
        <span role="img" aria-label={alt} className="absolute inset-0 flex items-center justify-center">
          <ImageOff size={22} strokeWidth={1.75} aria-hidden />
        </span>
      ) : (
        <img
          src={src}
          alt={onClick ? '' : alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          ref={imgRef}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setFailedSrc(src)}
          className={cn(
            'absolute inset-0 size-full transition-opacity duration-300',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      {overlay ? <span className="pointer-events-none absolute inset-0">{overlay}</span> : null}
    </Tag>
  );
});

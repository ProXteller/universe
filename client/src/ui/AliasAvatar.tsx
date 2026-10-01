import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface AliasAvatarProps {
  emoji: string;
  /** Hex string from the Buzz serializer (`ALIAS_COLORS`). */
  color: string;
  /** sm 28 · md 36 (default). */
  size?: 'sm' | 'md';
  className?: string;
}

const PX = { sm: 28, md: 36 } as const;

/**
 * Buzz only — a separate component so an anonymous surface can never be handed a user. Never an image,
 * never an orbit ring, never clickable. Pair it with the alias label (`type-label-sm`).
 */
export const AliasAvatar = forwardRef<HTMLSpanElement, AliasAvatarProps>(function AliasAvatar(
  { emoji, color, size = 'md', className },
  ref,
) {
  const px = PX[size];
  return (
    <span
      ref={ref}
      aria-hidden
      style={{
        width: px,
        height: px,
        fontSize: Math.round(px * 0.55),
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        borderColor: color,
      }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed leading-none select-none',
        className,
      )}
    >
      {emoji}
    </span>
  );
});

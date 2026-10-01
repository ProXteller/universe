import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type IconButtonVariant = 'ghost' | 'filled' | 'glass' | 'accent';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Required: icon-only controls have no visible name. */
  'aria-label': string;
  /** `ghost` (default) · `filled` (surface-3) · `glass` (over media) · `accent`. */
  variant?: IconButtonVariant;
  /** sm 36 (icon 18) · md 44 (icon 20, default) · lg 52 (icon 24). */
  size?: IconButtonSize;
  /** Unread count ("99+" above 99) or a bare dot. `0` renders nothing. */
  badge?: number | 'dot';
  /** Toggled state: fills the glyph (heart / bookmark only) and sets `aria-pressed`. */
  active?: boolean;
  activeTone?: 'accent' | 'love';
  to?: string;
}

const base =
  'press-icon relative inline-flex shrink-0 select-none items-center justify-center rounded-full ' +
  'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const sizes: Record<IconButtonSize, string> = {
  sm: 'size-9 before:absolute before:-inset-1',
  md: 'size-11',
  lg: 'size-13',
};

const glyph: Record<IconButtonSize, number> = { sm: 18, md: 20, lg: 24 };

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-3',
  filled: 'bg-surface-3 text-ink hover:bg-surface-4 active:bg-surface-4',
  glass: 'bg-black/35 text-white backdrop-blur-md hover:bg-black/45 active:bg-black/55',
  accent: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    icon: Icon,
    variant = 'ghost',
    size = 'md',
    badge,
    active,
    activeTone = 'accent',
    to,
    className,
    disabled,
    type,
    onClick,
    ...rest
  },
  ref,
) {
  const tone = active ? (activeTone === 'love' ? 'text-love hover:text-love' : variant === 'accent' ? '' : 'text-accent-ink hover:text-accent-ink') : '';
  const classes = cn(base, sizes[size], variants[variant], tone, className);
  const showBadge = badge === 'dot' || (typeof badge === 'number' && badge > 0);

  const content = (
    <>
      <Icon
        size={glyph[size]}
        strokeWidth={1.75}
        aria-hidden
        className={cn('transition-[fill] duration-150', active ? 'fill-current' : 'fill-transparent')}
      />
      {showBadge ? (
        badge === 'dot' ? (
          <span aria-hidden className="absolute top-[22%] right-[22%] size-2 rounded-full bg-accent ring-2 ring-canvas" />
        ) : (
          <span
            aria-hidden
            className="absolute top-[10%] right-[6%] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 type-micro text-on-accent tabular-nums ring-2 ring-canvas"
          >
            {(badge as number) > 99 ? '99+' : badge}
          </span>
        )
      ) : null}
    </>
  );

  if (to !== undefined) {
    const { 'aria-label': ariaLabel, id, title, tabIndex, style } = rest;
    return (
      <Link
        ref={ref as unknown as Ref<HTMLAnchorElement>}
        to={to}
        id={id}
        title={title}
        style={style}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : tabIndex}
        draggable={false}
        className={classes}
        onClick={(e) => {
          if (disabled) {
            e.preventDefault();
            return;
          }
          onClick?.(e as unknown as MouseEvent<HTMLButtonElement>);
        }}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      className={classes}
      onClick={onClick}
      {...rest}
    >
      {content}
    </button>
  );
});

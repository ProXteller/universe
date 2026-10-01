import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'hero' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default `'primary'`. `'hero'` = the gradient CTA, max one per screen. */
  variant?: ButtonVariant;
  /** Control height: sm 36 · md 44 (default) · lg 52. `sm` keeps a 44px hit area. */
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Label fades to three pulsing dots; width stays locked; clicks are ignored. */
  loading?: boolean;
  leftIcon?: LucideIcon;
  rightIcon?: LucideIcon;
  /** Renders a router `<Link>` with the same look (replaces design's `asChild`). */
  to?: string;
}

const base =
  'press relative inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-full whitespace-nowrap ' +
  'disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 type-label-sm before:absolute before:-inset-1',
  md: 'h-11 px-5 type-label',
  lg: 'h-13 px-6 type-label',
};

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press',
  hero: 'bg-hero text-on-accent shadow-glow hover:brightness-110 active:brightness-95',
  secondary:
    'border border-line bg-surface-3 text-ink inset-shadow-hairline hover:border-line-strong active:bg-surface-4',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink active:bg-surface-2',
  outline: 'border border-accent-line bg-transparent text-accent-ink hover:bg-accent-soft active:bg-accent-soft',
  danger: 'bg-danger-fill text-white hover:brightness-110 active:brightness-90',
  'danger-ghost': 'bg-transparent text-danger hover:bg-danger-soft active:bg-danger-soft',
};

const iconSize: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** The only way to render a text action. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    loading = false,
    leftIcon: LeftIcon,
    rightIcon: RightIcon,
    to,
    className,
    children,
    disabled,
    type,
    onClick,
    ...rest
  },
  ref,
) {
  const inactive = Boolean(disabled) || loading;
  const classes = cn(base, sizes[size], variants[variant], fullWidth && 'w-full', loading && 'pointer-events-none', className);
  const px = iconSize[size];
  const stroke = px <= 16 ? 2 : 1.75;

  const content = (
    <>
      <span className={cn('inline-flex min-w-0 items-center justify-center gap-2 transition-opacity duration-150', loading && 'opacity-0')}>
        {LeftIcon ? <LeftIcon size={px} strokeWidth={stroke} aria-hidden className="shrink-0" /> : null}
        {children != null && children !== false ? <span className="truncate">{children}</span> : null}
        {RightIcon ? <RightIcon size={px} strokeWidth={stroke} aria-hidden className="shrink-0" /> : null}
      </span>
      {loading ? (
        <span className="uv-dots absolute inset-0 justify-center" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      ) : null}
    </>
  );

  if (to !== undefined) {
    const { 'aria-label': ariaLabel, 'aria-describedby': describedBy, id, title, tabIndex, style } = rest;
    return (
      <Link
        ref={ref as unknown as Ref<HTMLAnchorElement>}
        to={to}
        id={id}
        title={title}
        style={style}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-disabled={disabled || undefined}
        aria-busy={loading || undefined}
        tabIndex={inactive ? -1 : tabIndex}
        draggable={false}
        className={classes}
        onClick={(e) => {
          if (inactive) {
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
      aria-busy={loading || undefined}
      className={classes}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {content}
    </button>
  );
});

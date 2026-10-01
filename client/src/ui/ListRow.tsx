import { forwardRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ListRowProps {
  /** Avatar, icon disc… 40–56px. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Top-right timestamp / count. */
  meta?: ReactNode;
  /** A node (Switch, FollowButton, Badge) or `'chevron'`. Interactive trailing nodes stay clickable on their own. */
  trailing?: ReactNode | 'chevron';
  onClick?(): void;
  to?: string;
  /** Title weight 600 + an 8px accent dot in the trailing column. */
  unread?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * The universal row. When the row is pressable the title carries a stretched `<a>`/`<button>` (it covers the
 * whole row) and the trailing slot sits above it, so a Switch or FollowButton inside a tappable row is valid
 * HTML and still works. Inside a Card group: the group has the border, rows have none.
 */
export const ListRow = forwardRef<HTMLDivElement, ListRowProps>(function ListRow(
  { leading, title, subtitle, meta, trailing, onClick, to, unread = false, destructive = false, disabled = false, className },
  ref,
) {
  const pressable = !disabled && (to !== undefined || Boolean(onClick));
  const titleClass = cn(
    'block min-w-0 truncate text-left type-headline',
    unread ? 'font-semibold' : 'font-medium',
    destructive ? 'text-danger' : 'text-ink',
  );
  const stretch = 'outline-none after:absolute after:inset-0 focus-visible:after:focus-ring after:rounded-[inherit]';

  const titleNode =
    pressable && to !== undefined ? (
      <Link to={to} onClick={onClick} draggable={false} className={cn(titleClass, stretch)}>
        {title}
      </Link>
    ) : pressable ? (
      <button type="button" onClick={onClick} className={cn(titleClass, stretch, 'w-full')}>
        {title}
      </button>
    ) : (
      <span className={titleClass}>{title}</span>
    );

  return (
    <div
      ref={ref}
      aria-disabled={disabled || undefined}
      className={cn(
        'group/row relative flex w-full min-w-0 items-center gap-3 px-4 transition-colors duration-150 ease-out',
        subtitle ? 'min-h-17' : 'min-h-14',
        pressable && 'cursor-pointer hover:bg-surface-2/60 active:bg-surface-2 has-[:focus-visible]:bg-surface-2/60',
        disabled && 'pointer-events-none opacity-45',
        className,
      )}
    >
      {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
      <div className="flex min-w-0 flex-1 items-center gap-3 self-stretch border-b border-line-subtle py-3 group-last/row:border-transparent">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <div className="min-w-0 flex-1">{titleNode}</div>
            {meta ? <div className="shrink-0 type-caption text-ink-3 tabular-nums">{meta}</div> : null}
          </div>
          {subtitle ? (
            <div className={cn('mt-0.5 truncate type-footnote', unread ? 'text-ink-2' : 'text-ink-3')}>{subtitle}</div>
          ) : null}
        </div>
        {unread ? <span aria-label="Unread" role="img" className="size-2 shrink-0 rounded-full bg-accent" /> : null}
        {trailing === 'chevron' ? (
          <ChevronRight size={18} strokeWidth={2} aria-hidden className="shrink-0 text-ink-4" />
        ) : trailing ? (
          <div className="relative z-[1] flex shrink-0 items-center">{trailing}</div>
        ) : null}
      </div>
    </div>
  );
});

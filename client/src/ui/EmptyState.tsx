import { forwardRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick(): void };
  secondary?: { label: string; onClick(): void };
  /** Inline version for sections and sheets: smaller disc, no orbit rings, tighter spacing. */
  compact?: boolean;
  className?: string;
}

/** Shared by EmptyState and ErrorState: the icon disc with the two faint orbit rings (the brand motif). */
export function StateDisc({ icon: Icon, tone = 'accent', compact = false }: { icon: LucideIcon; tone?: 'accent' | 'danger'; compact?: boolean }) {
  return (
    <div aria-hidden className={cn('relative flex shrink-0 items-center justify-center', compact ? 'size-14' : 'size-32')}>
      {compact ? null : (
        <>
          <span className="absolute size-32 rounded-full border border-line-subtle" />
          <span className="absolute size-24 rounded-full border border-line" />
        </>
      )}
      <span
        className={cn(
          'relative flex items-center justify-center rounded-full',
          compact ? 'size-14' : 'size-18',
          tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-ink',
        )}
      >
        <Icon size={compact ? 24 : 28} strokeWidth={1.75} />
      </span>
    </div>
  );
}

/** Centred in the remaining space (give the parent `flex-1`; `<Screen>`'s content column already is). */
export const EmptyState = forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { icon, title, description, action, secondary, compact = false, className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('flex w-full flex-col items-center justify-center text-center', compact ? 'gap-3 px-4 py-8' : 'flex-1 gap-4 px-8 py-12', className)}
    >
      <StateDisc icon={icon} compact={compact} />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className={cn('line-clamp-2 text-ink', compact ? 'type-headline' : 'type-title-2')}>{title}</h2>
        {description ? <p className={cn('line-clamp-3 max-w-[280px] text-ink-2', compact ? 'type-footnote' : 'type-body')}>{description}</p> : null}
      </div>
      {action || secondary ? (
        <div className="mt-1 flex flex-col items-center gap-1">
          {action ? (
            <Button size={compact ? 'sm' : 'md'} onClick={action.onClick}>
              {action.label}
            </Button>
          ) : null}
          {secondary ? (
            <Button variant="ghost" size="sm" onClick={secondary.onClick}>
              {secondary.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

import { forwardRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { Sheet } from './Sheet';

export interface ActionSheetAction {
  icon?: LucideIcon;
  label: string;
  destructive?: boolean;
  onSelect(): void;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  title?: ReactNode;
  actions: ActionSheetAction[];
  className?: string;
}

/** Sheet + a grouped list of actions + a separated "Cancel". Selecting an action closes the sheet first. */
export const ActionSheet = forwardRef<HTMLDivElement, ActionSheetProps>(function ActionSheet(
  { open, onOpenChange, title, actions, className },
  ref,
) {
  return (
    <Sheet ref={ref} open={open} onOpenChange={onOpenChange} title={title} aria-label="Actions" className={className}>
      <div role="group" className="overflow-hidden rounded-lg border border-line bg-surface-3">
        {actions.map((action, i) => {
          const Icon = action.icon;
          return (
            <button
              key={`${action.label}-${i}`}
              type="button"
              onClick={() => {
                onOpenChange(false);
                action.onSelect();
              }}
              className={cn(
                'flex min-h-14 w-full items-center gap-3 px-4 text-left type-headline font-medium transition-colors duration-150 ease-out',
                'hover:bg-surface-4 active:bg-surface-4',
                i > 0 && 'border-t border-line-subtle',
                action.destructive ? 'text-danger' : 'text-ink',
              )}
            >
              {Icon ? (
                <Icon size={20} strokeWidth={1.75} aria-hidden className={cn('shrink-0', action.destructive ? 'text-danger' : 'text-ink-2')} />
              ) : null}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </button>
          );
        })}
      </div>
      <Button variant="secondary" size="lg" fullWidth className="mt-3" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
    </Sheet>
  );
});

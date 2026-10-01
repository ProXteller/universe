/**
 * Settings building blocks (design §7.9): compact header, `type-overline` group labels, grouped Cards of ListRows.
 * Sub-pages push and hide the nav (`<Screen>` default `nav={false}`).
 */
import type { FC, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Card, PageHeader, Screen, Skeleton } from '@/ui';
import { cn } from '@/lib/cn';

export const SettingsScreen: FC<{ title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }> = ({
  title, subtitle, actions, children, className,
}) => (
  <Screen header={<PageHeader title={title} subtitle={subtitle} mode="compact" back actions={actions} />} className={cn('gap-6 px-4 pb-4 pt-2', className)}>
    {children}
  </Screen>
);

/** A labelled group: the Card carries the border; rows inside carry none. */
export const Group: FC<{ label?: string; description?: string; children: ReactNode; className?: string }> = ({ label, description, children, className }) => (
  <section className={cn('flex flex-col gap-2', className)} aria-label={label}>
    {label ? <h2 className="px-1 type-overline text-ink-3">{label}</h2> : null}
    <Card className="overflow-hidden p-0">{children}</Card>
    {description ? <p className="px-1 type-caption text-ink-3">{description}</p> : null}
  </section>
);

/** 36px icon disc for row leading slots. */
export const RowIcon: FC<{ icon: LucideIcon; tone?: 'neutral' | 'accent' | 'danger' | 'incognito' }> = ({ icon: Icon, tone = 'neutral' }) => (
  <span
    aria-hidden
    className={cn(
      'flex size-9 shrink-0 items-center justify-center rounded-full',
      tone === 'accent' && 'bg-accent-soft text-accent-ink',
      tone === 'danger' && 'bg-danger-soft text-danger',
      tone === 'incognito' && 'bg-incog-surface-2 text-incog-500',
      tone === 'neutral' && 'bg-surface-3 text-ink-2',
    )}
  >
    <Icon size={18} strokeWidth={1.75} />
  </span>
);

export const RowsSkeleton: FC<{ rows?: number }> = ({ rows = 4 }) => (
  <Card className="overflow-hidden p-0" aria-busy="true" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => (
      <div key={i} className="flex min-h-14 items-center gap-3 px-4">
        <Skeleton w={36} h={36} circle />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton w="40%" h={14} />
          <Skeleton w="60%" h={10} />
        </div>
      </div>
    ))}
  </Card>
);

/** Prose block for the static pages (Buzz anonymity, Terms, Privacy). */
export const Prose: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="flex flex-col gap-4 [&_h2]:type-title-3 [&_h2]:text-ink [&_h2]:mt-2 [&_p]:type-body [&_p]:text-ink-2 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5 [&_li]:list-disc [&_li]:type-body [&_li]:text-ink-2">
    {children}
  </div>
);

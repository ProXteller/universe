/**
 * ComposerModeBanner + ComposerGuard — the composer half of the anonymity firewall (Constitution §5.4).
 */
import { forwardRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { VenetianMask } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { routes } from '@/lib/links';
import { useCanPost, useMeOptional } from '@/lib/session';
import { UserAvatar } from './UserAvatar';

export interface ComposerModeBannerProps {
  /** REQUIRED, no default: the caller states the mode explicitly on every create / edit surface. */
  mode: 'public' | 'incognito';
  /** "Posting" | "Listing" | "Commenting" | "Hosting" | "Creating". Default "Posting". */
  verb?: string;
  note?: string;
  /** `'inline'` = one-line variant for comment / reply bars. */
  size?: 'md' | 'inline';
  className?: string;
}

/**
 * public: viewer avatar + "{verb} as @handle" · incognito: mask glyph + "You're anonymous" on the Phosphor soft gradient.
 * Mandatory on every create / edit surface.
 */
export const ComposerModeBanner = forwardRef<HTMLDivElement, ComposerModeBannerProps>(function ComposerModeBanner(
  { mode, verb = 'Posting', note, size = 'md', className },
  ref,
) {
  const me = useMeOptional();
  const inline = size === 'inline';

  if (mode === 'incognito') {
    return (
      <div
        ref={ref}
        data-composer-mode="incognito"
        className={cn(
          'flex items-center gap-2.5 bg-hero-soft text-ink',
          inline ? 'min-h-8 rounded-full px-3 py-1' : 'min-h-14 rounded-lg border border-accent-line px-3.5 py-2.5',
          className,
        )}
      >
        <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink', inline ? 'size-6' : 'size-9')}>
          <VenetianMask size={inline ? 14 : 18} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className={cn(inline ? 'type-caption' : 'type-overline', 'text-accent-ink')}>You're anonymous</span>
          {!inline ? <span className="type-caption text-ink-3">{note ?? 'A per-thread alias is shown instead of your profile.'}</span> : null}
        </div>
      </div>
    );
  }

  const handle = me ? `@${me.handle}` : 'you';
  return (
    <div
      ref={ref}
      data-composer-mode="public"
      className={cn(
        'flex items-center gap-2.5 text-ink',
        inline ? 'min-h-8 rounded-full bg-surface-2 px-2 py-1' : 'min-h-14 rounded-lg border border-line bg-surface-1 px-3.5 py-2.5',
        className,
      )}
    >
      {me ? (
        <UserAvatar user={me} size={inline ? 'xs' : 'sm'} link={false} />
      ) : (
        <span className={cn('shrink-0 rounded-full bg-surface-3', inline ? 'size-6' : 'size-8')} aria-hidden />
      )}
      <div className="flex min-w-0 flex-col">
        <span className={cn(inline ? 'type-caption' : 'type-label-sm', 'truncate')}>
          {verb} as <span className="text-accent-ink">{handle}</span>
        </span>
        {!inline && note ? <span className="truncate type-caption text-ink-3">{note}</span> : null}
      </div>
    </div>
  );
});

export interface ComposerGuardProps {
  scope?: 'public' | 'buzz';
  children: ReactNode;
  className?: string;
}

/** Replaces its children with the disabled "Muted until {date} · Details" bar while the viewer cannot post. */
export const ComposerGuard = forwardRef<HTMLDivElement, ComposerGuardProps>(function ComposerGuard({ scope = 'public', children, className }, ref) {
  const { allowed, mutedUntil } = useCanPost(scope);
  if (allowed) return <>{children}</>;
  return (
    <div
      ref={ref}
      role="status"
      className={cn('flex min-h-12 items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-4 py-2 type-footnote text-ink-2', className)}
    >
      <span className="truncate">{mutedUntil ? `Muted until ${formatDate(mutedUntil)}` : 'Posting is paused on your account'}</span>
      <Link to={routes.accountStatus()} className="shrink-0 type-label-sm text-accent-ink">
        Details
      </Link>
    </div>
  );
});

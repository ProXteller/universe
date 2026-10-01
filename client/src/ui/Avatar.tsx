import { forwardRef, useEffect, useState, type Ref } from 'react';
import { cn } from '@/lib/cn';
import { VerifiedBadge } from './Badge';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface AvatarProps {
  src?: string | null;
  /** Used for `alt` and the initials fallback. */
  name: string;
  /** xs 24 · sm 32 · md 40 (default) · lg 56 · xl 80 · 2xl 104. */
  size?: AvatarSize;
  /** People are circles; orgs are rounded squares (30%). */
  shape?: 'circle' | 'org';
  /**
   * `orbit` = aurora ring with a canvas gap · `seen` = hairline · `live` = orbit + circling dot.
   * A ring adds 8px to the outer box — reserve it in the layout.
   */
  ring?: 'none' | 'orbit' | 'seen' | 'live';
  /** Messages only. */
  presence?: 'online' | 'offline';
  /** Gold tick bottom-right (rendered from `lg` up). */
  badge?: 'verified';
  onClick?(): void;
  className?: string;
}

const PX: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 40, lg: 56, xl: 80, '2xl': 104 };
const INITIALS: Record<AvatarSize, string> = {
  xs: 'text-[0.5625rem]',
  sm: 'text-2xs',
  md: 'text-sm',
  lg: 'text-lg',
  xl: 'text-2xl',
  '2xl': 'text-3xl',
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase() || '?';
}

/** Real people and orgs only — never inside Buzz (use `AliasAvatar` there). */
export const Avatar = forwardRef<HTMLElement, AvatarProps>(function Avatar(
  { src, name, size = 'md', shape = 'circle', ring = 'none', presence, badge, onClick, className },
  ref,
) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const px = PX[size];
  const ringed = ring !== 'none';
  const outer = ringed ? px + 8 : px;
  const radius = shape === 'org' ? 'rounded-[30%]' : 'rounded-full';
  const showImage = Boolean(src) && !failed;

  const face = (
    <span className={cn('relative block size-full overflow-hidden bg-surface-3', radius)}>
      {showImage ? (
        <img
          src={src ?? undefined}
          alt={onClick ? '' : name}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span
          role={onClick ? undefined : 'img'}
          aria-label={onClick ? undefined : name}
          className={cn('flex size-full items-center justify-center font-display font-semibold text-ink-2 select-none', INITIALS[size])}
        >
          {initialsOf(name)}
        </span>
      )}
    </span>
  );

  const body = (
    <>
      {ringed ? (
        <span
          className={cn(
            'block size-full',
            radius,
            ring === 'seen' ? 'border-[1.5px] border-line-strong p-[2.5px]' : 'bg-aurora-ring p-[2px]',
          )}
        >
          <span className={cn('block size-full bg-canvas', radius, ring === 'seen' ? 'p-0' : 'p-[2px]')}>{face}</span>
        </span>
      ) : (
        face
      )}
      {ring === 'live' ? (
        <span aria-hidden className="uv-orbit-spin pointer-events-none absolute inset-0">
          <span className="absolute top-0 left-1/2 size-1.5 -translate-x-1/2 -translate-y-1/4 rounded-full bg-aurora-cyan ring-2 ring-canvas" />
        </span>
      ) : null}
      {presence === 'online' ? (
        <span
          role="img"
          aria-label="Online"
          className={cn('absolute size-2.5 rounded-full bg-online ring-2 ring-canvas', ringed ? 'right-1 bottom-1' : 'right-0 bottom-0')}
        />
      ) : null}
      {badge === 'verified' && px >= 56 ? (
        <span className={cn('absolute flex items-center justify-center rounded-full bg-canvas p-0.5', ringed ? 'right-0.5 bottom-0.5' : '-right-0.5 -bottom-0.5')}>
          <VerifiedBadge size={px >= 80 ? 22 : 18} />
        </span>
      ) : null}
    </>
  );

  // `radius` on the wrapper too: callers add cut-out rings (`ring-4 ring-canvas`, a box-shadow) via className, and an
  // unrounded wrapper draws that ring as a square. Radius without overflow-hidden never clips the badge or presence dot.
  const classes = cn('relative inline-block shrink-0 align-middle', radius, className);
  const style = { width: outer, height: outer };

  if (onClick) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        aria-label={name}
        onClick={onClick}
        style={style}
        className={cn(classes, 'press', px < 44 && 'before:absolute before:-inset-1.5')}
      >
        {body}
      </button>
    );
  }
  return (
    <span ref={ref as Ref<HTMLSpanElement>} style={style} className={classes}>
      {body}
    </span>
  );
});

/* ------------------------------------------------------------------ AvatarStack */

export interface AvatarStackProps {
  users: { src?: string | null; name: string; shape?: 'circle' | 'org' }[];
  /** Faces shown before "+N". Default 3. */
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  /** Real total when `users` is only a sample (drives "+N"). */
  total?: number;
  className?: string;
}

const OVERLAP: Record<'xs' | 'sm' | 'md', string> = { xs: '-ml-1.5', sm: '-ml-2', md: '-ml-2.5' };

export const AvatarStack = forwardRef<HTMLDivElement, AvatarStackProps>(function AvatarStack(
  { users, max = 3, size = 'sm', total, className },
  ref,
) {
  const shown = users.slice(0, max);
  const extra = Math.max(0, (total ?? users.length) - shown.length);
  const px = PX[size];
  const names = shown.map((u) => u.name).join(', ');
  return (
    <div ref={ref} role="img" aria-label={extra > 0 ? `${names} and ${extra} more` : names} className={cn('flex items-center', className)}>
      {shown.map((u, i) => (
        <span key={`${u.name}-${i}`} aria-hidden className={cn('rounded-full ring-2 ring-canvas', u.shape === 'org' && 'rounded-[30%]', i > 0 && OVERLAP[size])}>
          <Avatar src={u.src} name={u.name} size={size} shape={u.shape} className="block" />
        </span>
      ))}
      {extra > 0 ? (
        <span
          aria-hidden
          style={{ height: px, minWidth: px }}
          className={cn(
            'flex items-center justify-center rounded-full bg-surface-3 px-1.5 text-ink-2 tabular-nums ring-2 ring-canvas',
            size === 'xs' ? 'text-[0.5625rem] font-semibold' : 'type-micro',
            OVERLAP[size],
          )}
        >
          +{extra > 99 ? '99' : extra}
        </span>
      ) : null}
    </div>
  );
});

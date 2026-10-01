/**
 * Small shared pieces of the messages UI: conversation avatars, the reconnect bar, day separators, typing dots,
 * recipient safety banners.
 */
import type { FC, ReactNode } from 'react';
import { format, isSameYear, isToday, isYesterday } from 'date-fns';
import { ShieldAlert, WifiOff } from 'lucide-react';
import type { ConversationSummary, EpochMs, RecipientBanner, UserSummary } from '@shared/core';
import { Avatar, AvatarStack, Button } from '@/ui';
import { cn } from '@/lib/cn';
import { useWsStatus } from '@/lib/realtime';

/* ───────────────────────────── avatars ───────────────────────────── */

export const ConversationAvatar: FC<{ c: ConversationSummary; size?: 'sm' | 'md' | 'lg'; presence?: 'online' | 'offline' }> = ({ c, size = 'lg', presence }) => {
  if (c.kind === 'dm' || c.avatarUrl) {
    return (
      <Avatar
        src={c.avatarUrl}
        name={c.title}
        size={size}
        shape={c.peer?.accountType === 'org' ? 'org' : 'circle'}
        presence={c.kind === 'dm' ? presence : undefined}
        badge={c.peer?.isVerified ? 'verified' : undefined}
      />
    );
  }
  const users = c.memberPreview.map((u) => ({ src: u.avatarUrl, name: u.displayName, shape: u.accountType === 'org' ? ('org' as const) : ('circle' as const) }));
  if (users.length === 0) return <Avatar name={c.title} size={size} />;
  return (
    <span className="flex items-center" style={{ minWidth: size === 'lg' ? 56 : 40 }}>
      <AvatarStack users={users} max={size === 'lg' ? 3 : 2} size={size === 'lg' ? 'md' : 'sm'} total={c.memberCount} />
    </span>
  );
};

/* ───────────────────────────── reconnect bar (messages-only host, SPEC §4.4.2) ───────────────────────────── */

export const ReconnectBar: FC = () => {
  const status = useWsStatus();
  if (status !== 'reconnecting') return null;
  return (
    <div role="status" className="flex min-h-8 items-center justify-center gap-2 bg-warning-soft px-4 type-caption text-warning">
      <WifiOff size={14} strokeWidth={2} aria-hidden />
      Reconnecting…
    </div>
  );
};

/* ───────────────────────────── day separators ───────────────────────────── */

export function dayLabel(ts: EpochMs): string {
  const d = new Date(ts);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return isSameYear(d, new Date()) ? format(d, 'EEE, MMM d') : format(d, 'MMM d, yyyy');
}

export const DaySeparator: FC<{ ts: EpochMs }> = ({ ts }) => (
  <div className="flex justify-center py-3">
    <span className="type-caption text-ink-3">{dayLabel(ts)}</span>
  </div>
);

/* ───────────────────────────── typing ───────────────────────────── */

export const TypingDots: FC<{ label?: string | null }> = ({ label }) => (
  <div className="flex items-end gap-2 px-4 py-1" aria-live="polite">
    <div className="flex items-center rounded-[20px] rounded-bl-[6px] bg-surface-2 px-3.5 py-3 text-ink-3" aria-label={label ? `${label} is typing` : 'Typing'}>
      <span className="uv-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </div>
    {label ? <span className="type-caption text-ink-3">{label}</span> : null}
  </div>
);

/* ───────────────────────────── recipient banners (safety §7.3) ───────────────────────────── */

export const BANNER_COPY: Record<RecipientBanner, string> = {
  'B-SCAM': "Be careful. Never pay deposits or share codes for something you haven't seen. Keep deals in the app.",
  'B-OFFPLATFORM': 'This person shared contact details in their first message. Scammers often try to move chats off the app.',
  'B-STAFF-IMPERSONATION': 'UniVerse staff will never message you for a code.',
  'B-SEXUAL': 'You can block and report unwanted sexual messages.',
};

export const RecipientBannerView: FC<{ banner: RecipientBanner; sender: UserSummary | null; onBlockAndReport?(): void; className?: string }> = ({
  banner, sender, onBlockAndReport, className,
}) => (
  <div role="note" className={cn('flex flex-col gap-2 rounded-lg border border-warning/45 bg-warning-soft px-3.5 py-2.5', className)}>
    <div className="flex items-start gap-2">
      <ShieldAlert size={16} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-warning" />
      <p className="type-footnote text-ink">{BANNER_COPY[banner]}</p>
    </div>
    {sender && onBlockAndReport ? (
      <Button size="sm" variant="danger-ghost" onClick={onBlockAndReport} className="self-start">
        Block & report
      </Button>
    ) : null}
  </div>
);

/* ───────────────────────────── misc ───────────────────────────── */

export const Centered: FC<{ children: ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('flex flex-1 flex-col items-center justify-center px-4 py-10', className)}>{children}</div>
);

/**
 * Client side of the moderation contract (SPEC §4.4.1 `lib/moderation.ts`; copy from safety §2.10).
 * The sheets are rendered by `ModerationHost` (mounted once by AppShell); this module only drives them.
 */
import type { FC } from 'react';
import type { AuthorNotice, ContentBlockedDetails, ContentStatus, MutedDetails } from '@shared/core';
import { Badge, type SurfaceMode } from '@/ui';
import { useHomeStore } from '@/stores/home';
import { useUiStore } from '@/stores/ui';
import { isApiError } from './api';
import { formatDayTime } from './format';
import { toast } from './toast';

/**
 * The surface the user is on right now, for callers that don't pass `mode`: Buzz routes and Home resting on
 * Buzz are the incognito world (same rule as the shell's toaster), everything else is public. Captured when
 * the sheet is opened so ModerationHost (mounted outside every Surface) can re-stamp it, like `openReport`.
 */
function currentSurfaceMode(): SurfaceMode {
  if (typeof window === 'undefined') return 'public';
  const path = window.location.pathname;
  if (path === '/buzz' || path.startsWith('/buzz/')) return 'incognito';
  if (path.startsWith('/home') && useHomeStore.getState().tab === 'buzz') return 'incognito';
  return 'public';
}

/**
 * Handles the three write-time outcomes every mutation can hit. Returns `true` when handled:
 *   422 `content_blocked` → block sheet ([Edit] [Read the guidelines] + [Get help reporting] for M-NAMED) + support sheet
 *   403 `muted`           → toast
 *   429                   → toast "You're going fast…"
 * `mode` = the caller's surface (Buzz → 'incognito'); defaults to the surface on screen at call time.
 */
export function handleModerationError(e: unknown, opts?: { onEdit?(): void; mode?: SurfaceMode }): boolean {
  if (!isApiError(e)) return false;
  if (e.status === 422 && e.code === 'content_blocked') {
    const d = (e.details ?? {}) as Partial<ContentBlockedDetails>;
    const details: ContentBlockedDetails = {
      messageId: d.messageId ?? 'M-GENERIC',
      title: d.title ?? e.message ?? "This can't be posted",
      category: d.category ?? null,
      guidelineAnchor: d.guidelineAnchor ?? null,
      support: d.support ?? null,
    };
    // The server's `message` is the user-facing body (safety §2.10); `details` carries the rest.
    const body = e.message && e.message !== details.title ? e.message : '';
    const mode = opts?.mode ?? currentSurfaceMode();
    useUiStore.getState().openModeration({ kind: 'blocked', details, body, onEdit: opts?.onEdit, mode });
    return true;
  }
  if (e.status === 403 && e.code === 'muted') {
    const d = e.details as Partial<MutedDetails> | undefined;
    const until = typeof d?.until === 'number' ? ` until ${formatDayTime(d.until)}` : '';
    toast.error(`You're muted${until}. You can read and vote, but you can't post.`);
    return true;
  }
  if (e.status === 429) {
    toast.error("You're going fast. Take a breather and try again in a moment.");
    return true;
  }
  return false;
}

const HELD_BODY =
  "Your post is with our safety team before it goes live. This usually takes under a day. You don't need to do anything.";

/** After a successful write: held toast and / or the support sheet (self-harm resources) in the caller's surface. */
export function showModerationNotice(n: AuthorNotice | undefined, opts?: { mode?: SurfaceMode }): void {
  if (!n) return;
  if (n.status === 'held') {
    toast.info(`In review — ${n.userMessage?.body ?? HELD_BODY}`, { duration: 7000 });
  }
  if (n.support) {
    const mode = opts?.mode ?? currentSurfaceMode();
    useUiStore.getState().openModeration({ kind: 'support', support: n.support, mode });
  }
}

const STATUS_LABEL: Partial<Record<ContentStatus, { label: string; tone: 'warning' | 'danger' | 'neutral' }>> = {
  held: { label: 'In review', tone: 'warning' },
  hidden: { label: 'Hidden pending review', tone: 'warning' },
  removed: { label: 'Removed', tone: 'danger' },
};

/** Author-only chip on held / hidden / removed items. Renders nothing for `active` / `deleted`. */
export const ContentStatusChip: FC<{ status: ContentStatus; className?: string }> = ({ status, className }) => {
  const def = STATUS_LABEL[status];
  if (!def) return null;
  return (
    <Badge variant="soft" tone={def.tone} className={className}>
      {def.label}
    </Badge>
  );
};

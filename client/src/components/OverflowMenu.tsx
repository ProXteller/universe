/**
 * OverflowMenu (SPEC §4.4.2): the `ActionSheet` preset every UGC item opens from its `Ellipsis` button.
 * Order: extra items → Share → Copy link → Report → Block @handle → Delete. No "Save" (§2.3).
 */
import { forwardRef, useMemo } from 'react';
import { Ban, Flag, Link2, Share, Trash2 } from 'lucide-react';
import type { ReportTarget, UserSummary } from '@shared/core';
import { ActionSheet, useSurfaceMode, type ActionSheetAction } from '@/ui';
import { openBlock, openReport } from '@/lib/report';
import { useMeOptional } from '@/lib/session';
import { copyLink, openShare, type OpenShareInput } from '@/lib/share';

export interface OverflowMenuProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Extra actions, shown first. */
  items?: ActionSheetAction[];
  share?: OpenShareInput;
  report?: ReportTarget;
  /** Public author to block (omit / null on Buzz and for self). */
  blockUser?: UserSummary | null;
  onDelete?(): void;
  /** Default "Delete". */
  deleteLabel?: string;
  title?: string;
  className?: string;
}

export const OverflowMenu = forwardRef<HTMLDivElement, OverflowMenuProps>(function OverflowMenu(
  { open, onOpenChange, items, share, report, blockUser, onDelete, deleteLabel = 'Delete', title, className },
  ref,
) {
  const me = useMeOptional();
  const mode = useSurfaceMode();

  const actions = useMemo<ActionSheetAction[]>(() => {
    const out: ActionSheetAction[] = [...(items ?? [])];
    if (share) {
      out.push({ icon: Share, label: 'Share', onSelect: () => openShare(share) });
      out.push({ icon: Link2, label: 'Copy link', onSelect: () => void copyLink(share.url) });
    }
    if (report) {
      out.push({ icon: Flag, label: 'Report', onSelect: () => openReport(report, mode) });
    }
    if (blockUser && me && blockUser.id !== me.id && mode === 'public') {
      out.push({ icon: Ban, label: `Block @${blockUser.handle}`, destructive: true, onSelect: () => openBlock(blockUser) });
    }
    if (onDelete) {
      out.push({ icon: Trash2, label: deleteLabel, destructive: true, onSelect: onDelete });
    }
    return out;
  }, [items, share, report, blockUser, onDelete, deleteLabel, me, mode]);

  if (actions.length === 0) return null;
  return <ActionSheet ref={ref} open={open} onOpenChange={onOpenChange} title={title} actions={actions} className={className} />;
});

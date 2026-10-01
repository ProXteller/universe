/**
 * Report / block entry points (SPEC §4.4.1 `lib/report.ts`). The sheets themselves are hosts mounted once by
 * `AppShell` (`ReportHost`, `BlockHost` in `components/`).
 */
import type { ReportTarget, UserSummary } from '@shared/core';
import type { SurfaceMode } from '@/ui';
import { useUiStore } from '@/stores/ui';

/**
 * Opens the ReportSheet. `mode` is the caller's surface mode captured at call time (Buzz passes `'incognito'`
 * and never passes `target.author`); default `'public'`.
 */
export function openReport(target: ReportTarget, mode: SurfaceMode = 'public'): void {
  useUiStore.getState().openReport({ target, mode });
}

export function openBlock(user: UserSummary, opts?: { onBlocked?(): void }): void {
  useUiStore.getState().openBlock({ user, onBlocked: opts?.onBlocked });
}

/**
 * UI store (SPEC §4.4.1 `stores/ui.ts`): nav visibility + the internal state of the overlay hosts that
 * `AppShell` mounts once (report / block / share / moderation sheets, Me sheet).
 */
import { create } from 'zustand';
import type { ContentBlockedDetails, ReportTarget, ShareCardRef, SupportResources, UserSummary } from '@shared/core';
import type { SurfaceMode } from '@/ui';

export { useNavVisibility as useNavVisible } from '@/ui/navVisibility';

export interface ReportRequest {
  target: ReportTarget;
  mode: SurfaceMode;
}

export interface BlockRequest {
  user: UserSummary;
  onBlocked?: () => void;
}

export interface ShareInput {
  card: ShareCardRef;
  url: string;
  title: string;
  text?: string;
  mode?: SurfaceMode;
}

/** `mode` = the caller's surface captured at call time (Buzz → 'incognito'); ModerationHost re-stamps it. */
export type ModerationOverlay =
  | { kind: 'blocked'; details: ContentBlockedDetails; body: string; onEdit?: () => void; mode?: SurfaceMode }
  | { kind: 'support'; support: SupportResources; mode?: SurfaceMode };

interface UiState {
  report: ReportRequest | null;
  block: BlockRequest | null;
  share: ShareInput | null;
  moderation: ModerationOverlay | null;
  meSheetOpen: boolean;
  openReport(r: ReportRequest): void;
  closeReport(): void;
  openBlock(b: BlockRequest): void;
  closeBlock(): void;
  openShare(s: ShareInput): void;
  closeShare(): void;
  openModeration(m: ModerationOverlay): void;
  closeModeration(): void;
  setMeSheetOpen(open: boolean): void;
  reset(): void;
}

const initial = { report: null, block: null, share: null, moderation: null, meSheetOpen: false };

export const useUiStore = create<UiState>((set) => ({
  ...initial,
  openReport: (report) => set({ report }),
  closeReport: () => set({ report: null }),
  openBlock: (block) => set({ block }),
  closeBlock: () => set({ block: null }),
  openShare: (share) => set({ share }),
  closeShare: () => set({ share: null }),
  openModeration: (moderation) => set({ moderation }),
  closeModeration: () => set({ moderation: null }),
  setMeSheetOpen: (meSheetOpen) => set({ meSheetOpen }),
  reset: () => set({ ...initial }),
}));

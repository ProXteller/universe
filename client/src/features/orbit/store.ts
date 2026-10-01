/**
 * Orbit UI state (zustand, UI only): the post composer's draft + open flag, so a draft survives closing the sheet
 * and switching Home tabs. Registered with `registerStoreReset` so logout wipes it (SPEC §4.4.1).
 */
import { create } from 'zustand';
import type { MediaImage } from '@shared/core';
import { registerStoreReset } from '@/lib/session';

export interface OrbitDraft {
  text: string;
  images: MediaImage[];
  poll: string[] | null;
}

const EMPTY_DRAFT: OrbitDraft = { text: '', images: [], poll: null };

interface OrbitUiState {
  composerOpen: boolean;
  draft: OrbitDraft;
  openComposer(): void;
  closeComposer(): void;
  setDraft(patch: Partial<OrbitDraft>): void;
  clearDraft(): void;
}

export const useOrbitStore = create<OrbitUiState>((set) => ({
  composerOpen: false,
  draft: EMPTY_DRAFT,
  openComposer: () => set({ composerOpen: true }),
  closeComposer: () => set({ composerOpen: false }),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
}));

let registered = false;
/** Idempotent; called from the pane on mount (never at import time — R4). */
export function ensureOrbitStoreReset(): void {
  if (registered) return;
  registered = true;
  registerStoreReset(() => useOrbitStore.setState({ composerOpen: false, draft: EMPTY_DRAFT }));
}

export function draftIsEmpty(d: OrbitDraft): boolean {
  return d.text.trim() === '' && d.images.length === 0 && (d.poll === null || d.poll.every((o) => o.trim() === ''));
}

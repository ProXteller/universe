/**
 * Buzz UI state (zustand, UI only — server state lives in TanStack Query). NO localStorage anywhere in Buzz
 * (safety L4): sort / scope / drafts / revealed folds all die with the session. `logout()` wipes this store through
 * `registerStoreReset` (registered lazily on first mount, R4: no import-time side effects).
 */
import { create } from 'zustand';
import type { FeedScope, HomeTab, Id } from '@shared/core';
import type { BuzzPollDuration, BuzzSort, BuzzTopWindow } from '@shared/buzz';
import { registerStoreReset } from '@/lib/session';

export interface ComposerDraft {
  text: string;
  pollOn: boolean;
  options: string[];
  durationDays: BuzzPollDuration;
  promptId: Id | null;
}

export const EMPTY_DRAFT: ComposerDraft = { text: '', pollOn: false, options: ['', ''], durationDays: 3, promptId: null };

interface BuzzState {
  sort: BuzzSort;
  window: BuzzTopWindow;
  scope: FeedScope;
  /** Cold-start: the campus feed came back empty and we moved to Global (banner until dismissed). */
  coldStart: boolean;
  coldStartDismissed: boolean;
  /** The last non-Buzz Home tab ("Not now" goes back there). */
  previousTab: HomeTab;
  composerOpen: boolean;
  draft: ComposerDraft;
  /** Community-collapsed / hidden-anon items the viewer tapped open this session. */
  revealed: Record<Id, true>;
  /** Reply drafts per thread. */
  replyDrafts: Record<Id, { text: string; parentId: Id | null }>;
  setSort(sort: BuzzSort): void;
  setWindow(window: BuzzTopWindow): void;
  setScope(scope: FeedScope, opts?: { coldStart?: boolean }): void;
  dismissColdStart(): void;
  setPreviousTab(tab: HomeTab): void;
  openComposer(prefill?: Partial<ComposerDraft>): void;
  closeComposer(): void;
  setDraft(patch: Partial<ComposerDraft>): void;
  clearDraft(): void;
  reveal(id: Id): void;
  setReplyDraft(threadId: Id, draft: { text: string; parentId: Id | null } | null): void;
}

const initial = (): Omit<BuzzState, keyof Actions> => ({
  sort: 'hot',
  window: 'day',
  scope: 'campus',
  coldStart: false,
  coldStartDismissed: false,
  previousTab: 'reels',
  composerOpen: false,
  draft: EMPTY_DRAFT,
  revealed: {},
  replyDrafts: {},
});

type Actions = Pick<
  BuzzState,
  | 'setSort' | 'setWindow' | 'setScope' | 'dismissColdStart' | 'setPreviousTab' | 'openComposer' | 'closeComposer' | 'setDraft' | 'clearDraft'
  | 'reveal' | 'setReplyDraft'
>;

export const useBuzzStore = create<BuzzState>((set) => ({
  ...initial(),
  setSort: (sort) => set({ sort }),
  setWindow: (window) => set({ window }),
  setScope: (scope, opts) => set({ scope, coldStart: opts?.coldStart ?? false, coldStartDismissed: false }),
  dismissColdStart: () => set({ coldStartDismissed: true }),
  setPreviousTab: (previousTab) => set({ previousTab }),
  openComposer: (prefill) => set((s) => ({ composerOpen: true, draft: prefill ? { ...s.draft, ...prefill } : s.draft })),
  closeComposer: () => set({ composerOpen: false }),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  reveal: (id) => set((s) => ({ revealed: { ...s.revealed, [id]: true } })),
  setReplyDraft: (threadId, draft) =>
    set((s) => {
      const next = { ...s.replyDrafts };
      if (draft) next[threadId] = draft;
      else delete next[threadId];
      return { replyDrafts: next };
    }),
}));

export function resetBuzzStore(): void {
  useBuzzStore.setState(initial());
}

let resetRegistered = false;
/** Idempotent; called from the pane / routes on mount so logout wipes every Buzz draft and fold (safety L4). */
export function ensureBuzzStoreReset(): void {
  if (resetRegistered) return;
  resetRegistered = true;
  registerStoreReset(resetBuzzStore);
}

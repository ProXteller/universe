/**
 * Buzz UI state (zustand, UI only — server state lives in TanStack Query). NO localStorage anywhere in Buzz
 * (safety L4): sort / scope / drafts / revealed folds all die with the session. `logout()` wipes this store through
 * `registerStoreReset` (registered lazily on first mount, R4: no import-time side effects).
 */
import { create } from 'zustand';
import type { FeedScope, HomeTab, Id, MediaImage } from '@shared/core';
import type { BuzzPollDuration, BuzzSort, BuzzTopWindow } from '@shared/buzz';
import { registerStoreReset } from '@/lib/session';

/** An uploaded video waiting in the composer. */
export interface DraftVideo {
  url: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface ComposerDraft {
  title: string;
  text: string;
  /** Which feed the buzz goes to. Set from the feed the composer was opened on. */
  scope: FeedScope;
  images: MediaImage[];
  video: DraftVideo | null;
  pollOn: boolean;
  options: string[];
  durationDays: BuzzPollDuration;
  promptId: Id | null;
}

export const EMPTY_DRAFT: ComposerDraft = {
  title: '', text: '', scope: 'campus', images: [], video: null, pollOn: false, options: ['', ''], durationDays: 3, promptId: null,
};

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
  /** Buzz search (kept for the session so "back" from a thread returns to the same results). */
  search: { q: string; scope: FeedScope; sort: BuzzSort };
  setSearch(patch: Partial<BuzzState['search']>): void;
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
  search: { q: '', scope: 'campus', sort: 'new' },
});

type Actions = Pick<
  BuzzState,
  | 'setSort' | 'setWindow' | 'setScope' | 'dismissColdStart' | 'setPreviousTab' | 'openComposer' | 'closeComposer' | 'setDraft' | 'clearDraft'
  | 'reveal' | 'setReplyDraft' | 'setSearch'
>;

export const useBuzzStore = create<BuzzState>((set) => ({
  ...initial(),
  setSort: (sort) => set({ sort }),
  setWindow: (window) => set({ window }),
  setScope: (scope, opts) => set({ scope, coldStart: opts?.coldStart ?? false, coldStartDismissed: false }),
  dismissColdStart: () => set({ coldStartDismissed: true }),
  setPreviousTab: (previousTab) => set({ previousTab }),
  // a fresh draft takes the feed it was opened on; a draft already in progress keeps the feed it chose
  openComposer: (prefill) =>
    set((s) => {
      const fresh = !s.draft.title && !s.draft.text && s.draft.images.length === 0 && !s.draft.video;
      const base = fresh ? { ...s.draft, scope: s.scope } : s.draft;
      return { composerOpen: true, draft: prefill ? { ...base, ...prefill } : base };
    }),
  closeComposer: () => set({ composerOpen: false }),
  setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
  clearDraft: () => set({ draft: EMPTY_DRAFT }),
  reveal: (id) => set((s) => ({ revealed: { ...s.revealed, [id]: true } })),
  setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
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

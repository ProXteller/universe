/**
 * `useAuthFlow` — the onboarding flow's client state (SPEC §5.1): email, signup token, resend timer, the draft
 * profile. Persisted in `sessionStorage['uv:auth:flow']` so a refresh resumes the right step with the draft intact.
 * Registered with `registerStoreReset` from `AuthRoutes` (an effect, never at import time — R4).
 *
 * The pending avatar PHOTO is deliberately not here (a File cannot be serialised); it lives in the profile screen.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AccountType, AuthStartResponse, AuthVerifyResponse, ClassKind, EpochMs, OrgCategory, UniversityRef } from '@shared/core';

export interface ProfileDraft {
  displayName: string;
  handle: string;
  accountType: AccountType;
  classYear: number | null;
  classKind: ClassKind | null;
  major: string;
  bio: string;
  orgCategory: OrgCategory | null;
  /** DiceBear seed chosen with "Shuffle" (null = the server's default, the user id). */
  avatarSeed: string | null;
  isAdult: boolean | null;
}

export const EMPTY_DRAFT: ProfileDraft = {
  displayName: '',
  handle: '',
  accountType: 'student',
  classYear: null,
  classKind: null,
  major: '',
  bio: '',
  orgCategory: null,
  avatarSeed: null,
  isAdult: null,
};

interface AuthFlowState {
  email: string;
  university: (UniversityRef & { isNew: boolean }) | null;
  expiresAt: EpochMs | null;
  resendAvailableAt: EpochMs | null;
  /** Dev inbox (non-production, no mail provider). Consumed by the code screen's toast. */
  devCode: string | null;
  signupToken: string | null;
  signupExpiresAt: EpochMs | null;
  suggested: { displayName: string; handle: string } | null;
  draft: ProfileDraft;
  /** One-shot inline notice for the email screen (e.g. an expired sign-up session). */
  notice: string | null;

  setEmail(email: string): void;
  setStart(r: AuthStartResponse): void;
  setNeedsProfile(r: Extract<AuthVerifyResponse, { status: 'needs_profile' }>): void;
  setDraft(patch: Partial<ProfileDraft>): void;
  setNotice(notice: string | null): void;
  clearDevCode(): void;
  /** Back to square one (after `/auth/complete`, a `signed_in` verify, or logout). */
  clear(): void;
}

const EMPTY = {
  email: '',
  university: null,
  expiresAt: null,
  resendAvailableAt: null,
  devCode: null,
  signupToken: null,
  signupExpiresAt: null,
  suggested: null,
  draft: EMPTY_DRAFT,
  notice: null,
} as const;

export const useAuthFlow = create<AuthFlowState>()(
  persist(
    (set) => ({
      ...EMPTY,
      setEmail: (email) => set({ email }),
      setStart: (r) =>
        set({
          email: r.email,
          university: r.university,
          expiresAt: r.expiresAt,
          resendAvailableAt: r.resendAvailableAt,
          devCode: r.devCode ?? null,
        }),
      setNeedsProfile: (r) =>
        set((s) => ({
          signupToken: r.signupToken,
          signupExpiresAt: r.expiresAt,
          email: r.email,
          university: r.university,
          suggested: r.suggested,
          devCode: null,
          draft: {
            ...EMPTY_DRAFT,
            // keep a draft the user already typed (refresh mid-profile); otherwise pre-fill from the server suggestion
            ...(s.draft.displayName || s.draft.handle ? s.draft : { displayName: r.suggested.displayName, handle: r.suggested.handle }),
          },
        })),
      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
      setNotice: (notice) => set({ notice }),
      clearDevCode: () => set({ devCode: null }),
      clear: () => set({ ...EMPTY }),
    }),
    {
      name: 'uv:auth:flow',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({
        email: s.email,
        university: s.university,
        expiresAt: s.expiresAt,
        resendAvailableAt: s.resendAvailableAt,
        devCode: s.devCode,
        signupToken: s.signupToken,
        signupExpiresAt: s.signupExpiresAt,
        suggested: s.suggested,
        draft: s.draft,
        notice: s.notice,
      }),
    },
  ),
);

export function resetAuthFlow(): void {
  useAuthFlow.getState().clear();
}

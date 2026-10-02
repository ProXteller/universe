/**
 * Typed API calls for the onboarding flow. Foundation endpoints #2–#12, #25, #8 + the slice's own
 * `/onboarding/*`. Every request goes through `@/lib/api`. Query keys start with `'auth'` (§4.4.5).
 */
import type {
  AcceptGuidelinesRequest, AuthCompleteRequest, AuthCompleteResponse, AuthStartRequest, AuthStartResponse, AuthVerifyRequest,
  AuthVerifyResponse, DomainLookupResponse, HandleAvailabilityResponse, InvitePreview, MeUser, PasswordCodeRequest,
  PasswordCodeResendResponse, PasswordLoginRequest, PasswordLoginResponse, UpdateMeRequest, WithModeration,
} from '@shared/core';
import { GUIDELINES_VERSION } from '@shared/core';
import type { FollowManyRequest, FollowManyResponse, OnboardingSuggestions } from '@shared/auth';
import { api } from '@/lib/api';

export const authKeys = {
  domain: (email: string) => ['auth', 'domain', email] as const,
  handle: (handle: string) => ['auth', 'handle', handle] as const,
  invite: (code: string) => ['auth', 'invite', code] as const,
  suggestions: () => ['auth', 'suggestions'] as const,
};

export const authApi = {
  lookupDomain: (email: string) => api.get<DomainLookupResponse>('/auth/domain', { email }),
  start: (body: AuthStartRequest) => api.post<AuthStartResponse>('/auth/start', body),
  verify: (body: AuthVerifyRequest) => api.post<AuthVerifyResponse>('/auth/verify', body),
  /** D9: optional password sign-in, then (two-factor on) the emailed code. */
  passwordLogin: (body: PasswordLoginRequest) => api.post<PasswordLoginResponse>('/auth/password/login', body),
  passwordVerify: (body: PasswordCodeRequest) => api.post<AuthVerifyResponse>('/auth/password/verify', body),
  passwordResend: (challengeToken: string) => api.post<PasswordCodeResendResponse>('/auth/password/resend', { challengeToken }),
  handleAvailable: (handle: string) => api.get<HandleAvailabilityResponse>('/auth/handle-available', { handle }),
  complete: (body: AuthCompleteRequest) => api.post<AuthCompleteResponse>('/auth/complete', body),
  invitePreview: (code: string) => api.get<InvitePreview>(`/invites/${encodeURIComponent(code)}`),
  patchMe: (body: UpdateMeRequest) => api.patch<WithModeration<MeUser>>('/me', body),
  acceptGuidelines: () => api.post<MeUser>('/me/guidelines', { kind: 'app', version: GUIDELINES_VERSION } satisfies AcceptGuidelinesRequest),
  completeOnboarding: () => api.post<MeUser>('/me/onboarding/complete'),
  suggestions: () => api.get<OnboardingSuggestions>('/onboarding/suggestions'),
  followMany: (body: FollowManyRequest) => api.post<FollowManyResponse>('/onboarding/follow-many', body),
};

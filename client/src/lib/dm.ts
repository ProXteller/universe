/**
 * `openDm` (SPEC §4.4.1 `lib/dm.ts`): `POST /dm` then navigate to the conversation with an optional draft.
 */
import type { ContextCardRef, Id, OpenDmRequest, OpenDmResponse } from '@shared/core';
import { api, errorMessage, isApiError } from './api';
import { routes } from './links';
import { navigateTo } from './navigation';
import { toast } from './toast';

export async function openDm(input: { userId: Id; context?: ContextCardRef; draft?: string }): Promise<void> {
  const body: OpenDmRequest = { userId: input.userId, context: input.context };
  try {
    const res = await api.post<OpenDmResponse>('/dm', body);
    navigateTo(routes.chat(res.conversationId), { state: input.draft ? { draft: input.draft } : undefined });
  } catch (e) {
    if (isApiError(e, 'cannot_message')) {
      toast.error("You can't message this account.");
      return;
    }
    if (isApiError(e) && e.status === 429) {
      toast.error("You're going fast. Try again in a moment.");
      return;
    }
    toast.error(errorMessage(e));
  }
}

/**
 * `messages` UI state (zustand, never server state): who is typing where, presence answers, and the outgoing
 * message bodies of failed sends so "Tap to retry" can resend them. Reset on logout (`registerStoreReset`).
 */
import { create } from 'zustand';
import type { EpochMs, Id, SendMessageRequest } from '@shared/core';
import { registerStoreReset } from '@/lib/session';

export interface TypingEntry {
  userId: Id;
  displayName: string;
  /** Auto-expires: typing events are re-sent by the sender while typing continues. */
  until: EpochMs;
}

export interface PresenceEntry {
  online: boolean;
  lastActiveAt: EpochMs | null;
}

interface MessagesUiState {
  typing: Record<Id, TypingEntry[]>;
  presence: Record<Id, PresenceEntry>;
  /** Failed optimistic sends keyed by clientId. */
  failedSends: Record<string, { conversationId: Id; body: SendMessageRequest }>;
  /** `readAt` of the last ws `read` event, keyed `${conversationId}:${userId}` ("Seen 3:45 PM"). */
  reads: Record<string, EpochMs>;
  setTyping(conversationId: Id, entry: TypingEntry, isTyping: boolean): void;
  setPresence(userId: Id, p: PresenceEntry): void;
  setRead(conversationId: Id, userId: Id, at: EpochMs): void;
  rememberFailed(clientId: string, conversationId: Id, body: SendMessageRequest): void;
  forgetFailed(clientId: string): void;
  reset(): void;
}

const initial = { typing: {}, presence: {}, failedSends: {}, reads: {} };

export const useMessagesStore = create<MessagesUiState>((set) => ({
  ...initial,
  setTyping(conversationId, entry, isTyping) {
    set((s) => {
      const rest = (s.typing[conversationId] ?? []).filter((t) => t.userId !== entry.userId);
      const next = isTyping ? [...rest, entry] : rest;
      return { typing: { ...s.typing, [conversationId]: next } };
    });
  },
  setPresence(userId, p) {
    set((s) => ({ presence: { ...s.presence, [userId]: p } }));
  },
  setRead(conversationId, userId, at) {
    set((s) => ({ reads: { ...s.reads, [`${conversationId}:${userId}`]: at } }));
  },
  rememberFailed(clientId, conversationId, body) {
    set((s) => ({ failedSends: { ...s.failedSends, [clientId]: { conversationId, body } } }));
  },
  forgetFailed(clientId) {
    set((s) => {
      if (!(clientId in s.failedSends)) return s;
      const { [clientId]: _gone, ...rest } = s.failedSends;
      return { failedSends: rest };
    });
  },
  reset() {
    set({ ...initial });
  },
}));

let registered = false;
/** Called once from the routes root (no import-time side effects, R4). */
export function ensureStoreReset(): void {
  if (registered) return;
  registered = true;
  registerStoreReset(() => useMessagesStore.getState().reset());
}

const TYPING_TTL_MS = 4000;

/** Live typing entries for a conversation (expired ones filtered out). */
export function useTypingIn(conversationId: Id, nowMs: EpochMs): TypingEntry[] {
  const entries = useMessagesStore((s) => s.typing[conversationId]);
  return (entries ?? []).filter((t) => t.until > nowMs);
}

export function typingUntil(nowMs: EpochMs): EpochMs {
  return nowMs + TYPING_TTL_MS;
}

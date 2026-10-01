/**
 * `messages` — query keys (reserved prefix `['messages', …]`, SPEC §4.4.5), fetchers and cache patch helpers.
 * Every request goes through `@/lib/api`.
 */
import { useQuery } from '@tanstack/react-query';
import type { ConversationSummary, Id, Message, Paginated, SendMessageRequest, WithModeration } from '@shared/core';
import type { ConversationDetail, InboxTab } from '@shared/messages';
import { api } from '@/lib/api';
import { prependInfiniteItem, queryClient, removeInfiniteItem, updateInfiniteItem, useInfiniteList } from '@/lib/query';

const BASE = '/conversations';

export const keys = {
  all: ['messages'] as const,
  inbox: (tab: InboxTab) => ['messages', 'inbox', tab] as const,
  inboxAll: ['messages', 'inbox'] as const,
  detail: (id: Id) => ['messages', 'detail', id] as const,
  thread: (id: Id) => ['messages', 'thread', id] as const,
  threadAll: ['messages', 'thread'] as const,
  people: (q: string) => ['messages', 'people', q] as const,
};

/** A thread row as the client keeps it: the server `Message` plus optimistic-send state. */
export interface LocalMessage extends Message {
  /** Optimistic row waiting for the server (id = clientId). */
  pending?: boolean;
  /** The send failed — "Not delivered. Tap to retry." */
  failed?: boolean;
  /** Body to resend on retry (failed rows only). */
  retry?: SendMessageRequest;
}

export function useInbox(tab: InboxTab, enabled = true) {
  return useInfiniteList<ConversationSummary>({ queryKey: [...keys.inbox(tab)], path: BASE, query: { tab }, enabled, limit: 30 });
}

export function useThread(id: Id, enabled = true) {
  return useInfiniteList<LocalMessage>({ queryKey: [...keys.thread(id)], path: `${BASE}/${encodeURIComponent(id)}/messages`, enabled, limit: 40 });
}

export function useConversation(id: Id, enabled = true) {
  return useQuery<ConversationDetail>({
    queryKey: keys.detail(id),
    queryFn: () => api.get<ConversationDetail>(`${BASE}/${encodeURIComponent(id)}`),
    enabled,
  });
}

/* ───────────────────────────── mutations (plain functions; pages wrap them in useMutation) ───────────────────────────── */

const conv = (id: Id) => `${BASE}/${encodeURIComponent(id)}`;
const msg = (id: Id, messageId: Id) => `${conv(id)}/messages/${encodeURIComponent(messageId)}`;

export const messagesApi = {
  send: (id: Id, body: SendMessageRequest) => api.post<WithModeration<Message>>(`${conv(id)}/messages`, body),
  remove: (id: Id, messageId: Id) => api.delete<Message>(msg(id, messageId)),
  react: (id: Id, messageId: Id, emoji: Message['reactions'][number]['emoji'] | null) => api.put<Message>(`${msg(id, messageId)}/reaction`, { emoji }),
  offer: (id: Id, messageId: Id, action: 'accept' | 'decline' | 'withdraw') => api.post<Message>(`${msg(id, messageId)}/offer`, { action }),
  read: (id: Id, messageId: Id) => api.post<void>(`${conv(id)}/read`, { messageId }),
  accept: (id: Id) => api.post<void>(`${conv(id)}/accept`),
  decline: (id: Id) => api.post<void>(`${conv(id)}/decline`),
  update: (id: Id, patch: { title?: string; muted?: boolean }) => api.patch<WithModeration<ConversationSummary>>(conv(id), patch),
  addMembers: (id: Id, userIds: Id[]) => api.post<ConversationDetail>(`${conv(id)}/members`, { userIds }),
  leave: (id: Id) => api.delete<void>(`${conv(id)}/members/me`),
  createGroup: (body: { title?: string; memberIds: Id[] }) => api.post<WithModeration<ConversationSummary>>(`${BASE}/groups`, body),
  /** Market's endpoint (§6): "Mark as sold?" after an accepted offer; a 404 means the slice is absent → hide the prompt. */
  markSold: (listingId: Id) => api.post<unknown>(`/market/listings/${encodeURIComponent(listingId)}/sold`),
};

/* ───────────────────────────── cache helpers ───────────────────────────── */

export function invalidateInbox(): void {
  void queryClient.invalidateQueries({ queryKey: keys.inboxAll });
}

export function invalidateConversation(id: Id): void {
  void queryClient.invalidateQueries({ queryKey: keys.detail(id) });
  invalidateInbox();
}

/** Adds (or replaces, by id / clientId) a message at the newest end of the thread cache. */
export function upsertThreadMessage(conversationId: Id, message: LocalMessage): void {
  const key = [...keys.thread(conversationId)];
  const cached = queryClient.getQueryData<{ pages: Paginated<LocalMessage>[] }>(key);
  const existing = cached?.pages.flatMap((p) => p.items).find((m) => m.id === message.id || (message.clientId && m.id === message.clientId));
  if (existing) {
    updateInfiniteItem<LocalMessage>(key, existing.id, () => message);
    return;
  }
  if (!cached) return; // nothing loaded yet — the first fetch will include it
  prependInfiniteItem<LocalMessage>(key, message);
}

export function patchThreadMessage(conversationId: Id, messageId: Id, fn: (m: LocalMessage) => LocalMessage): void {
  updateInfiniteItem<LocalMessage>([...keys.thread(conversationId)], messageId, fn);
}

export function removeThreadMessage(conversationId: Id, messageId: Id): void {
  removeInfiniteItem([...keys.thread(conversationId)], messageId);
}

export function markThreadMessageDeleted(conversationId: Id, messageId: Id): void {
  patchThreadMessage(conversationId, messageId, (m) => ({ ...m, deleted: true, text: '', images: [], card: null, offer: null, banner: null, reactions: [] }));
}

/** Patches one member's read pointer on the cached detail (ws `read`). */
export function patchMemberRead(conversationId: Id, userId: Id, lastReadMessageId: Id): void {
  queryClient.setQueryData<ConversationDetail>(keys.detail(conversationId), (d) =>
    d ? { ...d, members: d.members.map((m) => (m.id === userId ? { ...m, lastReadMessageId } : m)) } : d,
  );
}

/** Zeroes the unread count of one inbox row locally (after the viewer read the thread). */
export function clearInboxUnread(conversationId: Id): void {
  updateInfiniteItem<ConversationSummary>([...keys.inboxAll], conversationId, (c) => (c.unreadCount === 0 ? c : { ...c, unreadCount: 0 }));
}

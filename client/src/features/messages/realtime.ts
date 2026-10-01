/**
 * ws → cache plumbing for the messages routes (mounted once by `MessagesRoutes`).
 *   message.new / updated / deleted → thread cache · conversation.updated → detail + inbox (the pinned card flips live)
 *   typing / presence → UI store · read → member read pointers ("Seen").
 * Foundation invalidates the whole `['messages']` prefix on ws reconnect (§4.4.5).
 */
import { useEffect } from 'react';
import { useRealtime } from '@/lib/realtime';
import { queryClient } from '@/lib/query';
import { invalidateConversation, invalidateInbox, keys, markThreadMessageDeleted, patchMemberRead, upsertThreadMessage } from './api';
import { typingUntil, useMessagesStore } from './store';

export function useMessagesRealtime(): void {
  useRealtime('message.new', (e) => {
    upsertThreadMessage(e.conversationId, e.message);
    invalidateInbox();
  });
  useRealtime('message.updated', (e) => {
    upsertThreadMessage(e.conversationId, e.message);
  });
  useRealtime('message.deleted', (e) => {
    markThreadMessageDeleted(e.conversationId, e.messageId);
    invalidateInbox();
  });
  useRealtime('conversation.updated', (e) => {
    invalidateConversation(e.conversationId);
  });
  useRealtime('typing', (e) => {
    useMessagesStore.getState().setTyping(e.conversationId, { userId: e.userId, displayName: e.displayName, until: typingUntil(Date.now()) }, e.isTyping);
  });
  useRealtime('read', (e) => {
    patchMemberRead(e.conversationId, e.userId, e.lastReadMessageId);
    useMessagesStore.getState().setRead(e.conversationId, e.userId, e.readAt);
  });
  useRealtime('presence', (e) => {
    useMessagesStore.getState().setPresence(e.userId, { online: e.online, lastActiveAt: e.lastActiveAt });
  });

  // Leaving the messages area: mark everything stale (no refetch) so the next visit refetches straight away even
  // inside the 30 s staleTime — badges may have moved while the handlers above were unmounted.
  useEffect(
    () => () => {
      void queryClient.invalidateQueries({ queryKey: keys.all, refetchType: 'none' });
    },
    [],
  );
}

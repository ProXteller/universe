/**
 * `messages` slice entry (SPEC §4.6, R5: the export name is frozen). Nested routes of §4.5:
 * `/messages` · `/messages/requests` · `/messages/new` · `/messages/:conversationId` · `/messages/:conversationId/info`.
 * No import-time side effects (R4): the store reset registers on first render, the ws handlers mount with the routes.
 */
import { useEffect, type FC } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/components';
import { InboxPage } from './InboxPage';
import { InfoPage } from './InfoPage';
import { NewChatPage } from './NewChatPage';
import { useMessagesRealtime } from './realtime';
import { ensureStoreReset } from './store';
import { ThreadPage } from './ThreadPage';

export const MessagesRoutes: FC = () => {
  useEffect(() => ensureStoreReset(), []);
  useMessagesRealtime();
  return (
    <Routes>
      <Route index element={<InboxPage tab="chats" />} />
      <Route path="requests" element={<InboxPage tab="requests" />} />
      <Route path="new" element={<NewChatPage />} />
      <Route path=":conversationId" element={<ThreadPage />} />
      <Route path=":conversationId/info" element={<InfoPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

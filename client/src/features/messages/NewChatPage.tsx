/**
 * New message (design §7.4): people search, multi-select → one person opens a DM (`openDm`), two or more create a
 * group (name sheet with the mandatory `ComposerModeBanner verb="Creating"`, `POST /conversations/groups`).
 */
import { useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import type { UserSummary } from '@shared/core';
import { LIMITS } from '@shared/core';
import { GROUP_MEMBERS_MAX } from '@shared/messages';
import { Button, Input, PageHeader, Screen, Sheet } from '@/ui';
import { ComposerGuard, ComposerModeBanner } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { openDm } from '@/lib/dm';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { toast } from '@/lib/toast';
import { invalidateInbox, messagesApi } from './api';
import { PeoplePicker } from './PeoplePicker';

export const NewChatPage: FC = () => {
  const navigate = useNavigate();
  useScreenView('messages_new');
  const [selected, setSelected] = useState<UserSummary[]>([]);
  const [naming, setNaming] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (selected.length === 0 || busy) return;
    if (selected.length === 1) {
      setBusy(true);
      await openDm({ userId: selected[0]!.id });
      setBusy(false);
      return;
    }
    setNaming(true);
  };

  const createGroup = async () => {
    setBusy(true);
    try {
      const res = await messagesApi.createGroup({ title: title.trim() || undefined, memberIds: selected.map((u) => u.id) });
      showModerationNotice(res.moderation);
      invalidateInbox();
      setNaming(false);
      navigate(routes.chat(res.id), { replace: true });
    } catch (e) {
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const cta = (
    <div className="px-4 py-3">
      <Button variant="primary" fullWidth disabled={selected.length === 0} loading={busy && !naming} onClick={() => void start()}>
        {selected.length > 1 ? `Start group chat (${selected.length + 1})` : 'Start chat'}
      </Button>
    </div>
  );

  return (
    <Screen header={<PageHeader title="New message" back />} footer={cta}>
      <PeoplePicker selected={selected} onChange={setSelected} max={GROUP_MEMBERS_MAX} autoFocus placeholder="Search people or orgs" />
      <Sheet
        open={naming}
        onOpenChange={setNaming}
        title="Name your group"
        description="Optional — without a name the chat shows its members."
        footer={
          <Button variant="primary" fullWidth loading={busy} onClick={() => void createGroup()}>
            Create group
          </Button>
        }
      >
        <ComposerGuard>
          <div className="flex flex-col gap-3 px-4 pb-2">
            <ComposerModeBanner mode="public" verb="Creating" note={`${selected.length} people will be invited. People who don't follow you get a request.`} />
            <Input label="Group name" placeholder="CS 314 study group" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.groupTitle} autoFocus />
          </div>
        </ComposerGuard>
      </Sheet>
    </Screen>
  );
};

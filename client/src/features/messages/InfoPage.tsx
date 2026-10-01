/**
 * Conversation info (design §7.4): avatar hero, rename (groups only, `ComposerModeBanner`), members, add people,
 * mute, leave (course chats too), report; course chats: "Textbooks for {code}" and "Invite classmates".
 * DMs: the person, mute, block, report.
 */
import { useEffect, useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, BookOpen, Flag, Link2, LogOut, Pencil, UserPlus } from 'lucide-react';
import type { UserSummary } from '@shared/core';
import { LIMITS } from '@shared/core';
import { GROUP_MEMBERS_MAX } from '@shared/messages';
import { Button, Dialog, ErrorState, IconButton, Input, ListRow, PageHeader, Screen, Sheet, Skeleton, Switch } from '@/ui';
import { ComposerGuard, ComposerModeBanner, SectionHeader, UserRow } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { routes } from '@/lib/links';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { openBlock, openReport } from '@/lib/report';
import { absoluteUrl, copyLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { queryClient } from '@/lib/query';
import { invalidateConversation, invalidateInbox, keys, messagesApi, useConversation } from './api';
import { ConversationAvatar } from './parts';
import { PeoplePicker } from './PeoplePicker';

export const InfoPage: FC = () => {
  const { conversationId = '' } = useParams<{ conversationId: string }>();
  const id = conversationId;
  const navigate = useNavigate();
  useScreenView('messages_info');
  const detail = useConversation(id, !!id);
  const d = detail.data ?? null;

  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<UserSummary[]>([]);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (d) setTitle(d.title);
  }, [d]);

  const isGroup = d?.kind === 'group';
  const canRename = isGroup && !d?.nameLocked;

  const setMuted = async (muted: boolean) => {
    if (!d) return;
    queryClient.setQueryData(keys.detail(id), { ...d, muted });
    try {
      await messagesApi.update(id, { muted });
      invalidateInbox();
    } catch (e) {
      queryClient.setQueryData(keys.detail(id), d);
      toast.error(errorMessage(e));
    }
  };

  const rename = async () => {
    const next = title.trim();
    if (!next || !d) return;
    setBusy(true);
    try {
      const res = await messagesApi.update(id, { title: next });
      showModerationNotice(res.moderation);
      invalidateConversation(id);
      setRenaming(false);
    } catch (e) {
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addPeople = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const res = await messagesApi.addMembers(id, picked.map((u) => u.id));
      queryClient.setQueryData(keys.detail(id), res);
      invalidateInbox();
      setAdding(false);
      setPicked([]);
      toast.success(picked.length === 1 ? 'Added' : `Added ${picked.length} people`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    try {
      await messagesApi.leave(id);
      invalidateInbox();
      navigate(routes.messages(), { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (detail.isError) {
    return (
      <Screen header={<PageHeader title="Info" back />}>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </Screen>
    );
  }

  const memberIds = d?.members.map((m) => m.id) ?? [];

  return (
    <Screen header={<PageHeader title={d ? (d.kind === 'dm' ? 'Chat info' : d.kind === 'course' ? 'Course chat' : 'Group info') : 'Info'} back />}>
      {!d ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8">
          <Skeleton w={80} h={80} circle />
          <Skeleton w={160} h={18} />
          <Skeleton w={100} h={12} />
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2 px-4 pt-6 pb-4">
            <ConversationAvatar c={d} size="lg" />
            <div className="flex items-center gap-1">
              <h1 className="text-center type-title-2">{d.title}</h1>
              {canRename ? <IconButton icon={Pencil} aria-label="Rename group" size="sm" onClick={() => setRenaming(true)} /> : null}
            </div>
            <p className="type-footnote text-ink-3">
              {d.kind === 'dm' && d.peer ? `@${d.peer.handle} · ${d.peer.universityShortName}` : d.kind === 'course' && d.course ? `${d.course.title} · ${d.course.term}` : `${d.memberCount} members`}
            </p>
            {d.kind === 'dm' && d.peer ? (
              <Button variant="secondary" size="sm" to={routes.profile(d.peer.handle)}>
                View profile
              </Button>
            ) : null}
          </div>

          {d.kind === 'course' && d.course ? (
            <div className="flex flex-col">
              <ListRow leading={<BookOpen size={20} strokeWidth={1.75} aria-hidden className="text-accent-ink" />} title={`Textbooks for ${d.course.code}`} subtitle="Listings tagged with this course" to={routes.market({ course: d.course.code })} trailing="chevron" />
              <ListRow
                leading={<Link2 size={20} strokeWidth={1.75} aria-hidden className="text-accent-ink" />}
                title="Invite classmates"
                subtitle="Copy the join link"
                onClick={() => void copyLink(absoluteUrl(routes.course(d.course!.courseId)))}
              />
            </div>
          ) : null}

          <div className="flex flex-col">
            <ListRow title="Mute notifications" subtitle="Unread counts stay quiet" trailing={<Switch checked={d.muted} onChange={(v) => void setMuted(v)} aria-label="Mute notifications" />} />
          </div>

          {d.kind !== 'dm' ? (
            <>
              <SectionHeader title={`Members · ${d.memberCount}`} action={isGroup ? { label: 'Add people', onClick: () => setAdding(true) } : undefined} />
              <div className="flex flex-col">
                {d.members.map((m) => (
                  <UserRow key={m.id} user={m} reason={m.role === 'owner' ? 'Owner' : undefined} />
                ))}
              </div>
              {isGroup ? (
                <div className="px-4 py-2">
                  <Button variant="ghost" fullWidth leftIcon={UserPlus} onClick={() => setAdding(true)}>
                    Add people
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="mt-2 flex flex-col">
            {d.kind === 'dm' && d.peer ? (
              <ListRow leading={<Ban size={20} strokeWidth={1.75} aria-hidden />} title={`Block @${d.peer.handle}`} destructive onClick={() => openBlock(d.peer!, { onBlocked: () => navigate(routes.messages(), { replace: true }) })} />
            ) : null}
            <ListRow
              leading={<Flag size={20} strokeWidth={1.75} aria-hidden />}
              title={d.kind === 'dm' ? 'Report conversation' : 'Report chat'}
              onClick={() => openReport({ entityType: 'conversation', entityId: id, author: d.peer ?? undefined })}
            />
            <ListRow leading={<LogOut size={20} strokeWidth={1.75} aria-hidden />} title={d.kind === 'dm' ? 'Leave chat' : d.kind === 'course' ? 'Leave course chat' : 'Leave group'} destructive onClick={() => setLeaving(true)} />
          </div>
        </>
      )}

      <Sheet
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename group"
        footer={
          <Button variant="primary" fullWidth loading={busy} disabled={!title.trim() || title.trim() === d?.title} onClick={() => void rename()}>
            Save
          </Button>
        }
      >
        <ComposerGuard>
          <div className="flex flex-col gap-3 px-4 pb-2">
            <ComposerModeBanner mode="public" verb="Editing" />
            <Input label="Group name" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.groupTitle} autoFocus />
          </div>
        </ComposerGuard>
      </Sheet>

      <Sheet
        open={adding}
        onOpenChange={(o) => {
          setAdding(o);
          if (!o) setPicked([]);
        }}
        title="Add people"
        detents={['full']}
        footer={
          <Button variant="primary" fullWidth loading={busy} disabled={picked.length === 0} onClick={() => void addPeople()}>
            {picked.length > 1 ? `Add ${picked.length} people` : 'Add'}
          </Button>
        }
      >
        <div className="flex flex-col gap-2 pb-2">
          <div className="px-4">
            <ComposerModeBanner mode="public" verb="Inviting" note="People who don't follow you get a request first." />
          </div>
          <PeoplePicker selected={picked} onChange={setPicked} excludeIds={memberIds} max={Math.max(1, GROUP_MEMBERS_MAX + 1 - memberIds.length)} autoFocus />
        </div>
      </Sheet>

      <Dialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Leave this chat?"
        description={d?.kind === 'course' ? 'You can rejoin from the Campus hub any time.' : "You'll stop getting messages here. Someone can add you back later."}
        tone="danger"
        confirmLabel="Leave"
        onConfirm={async () => {
          setLeaving(false);
          await leave();
        }}
      />
    </Screen>
  );
};

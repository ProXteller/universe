/**
 * /buzz/mine — "My buzzes": the private list of own threads and replies (served only to the author) with the private
 * karma line. Linked from Settings → Privacy & safety; never from Home (safety L4).
 */
import { useEffect, useRef, useState, type FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { VenetianMask } from 'lucide-react';
import type { BuzzReply, MyBuzzItem, MyBuzzKind } from '@shared/buzz';
import { EmptyState, ErrorState, InfiniteSentinel, PageHeader, Screen, Surface, Tabs } from '@/ui';
import { isApiError } from '@/lib/api';
import { routes } from '@/lib/links';
import { ContentStatusChip } from '@/lib/moderation';
import { useBuzzKarma, useMyBuzzes } from './api';
import { BuzzCard, BuzzCardSkeleton } from './BuzzCard';
import { BuzzComposer } from './Composer';
import { BuzzGatePanel, useBuzzGate } from './gate';
import { AliasLine, BuzzText, VoteCluster } from './parts';
import { ensureBuzzStoreReset, useBuzzStore } from './store';

export const MinePage: FC = () => {
  const navigate = useNavigate();
  const { accepted } = useBuzzGate();
  useEffect(() => {
    ensureBuzzStoreReset();
  }, []);
  const back = (): void => {
    if (window.history.length > 1) navigate(-1);
    else navigate(routes.settings('privacy'), { replace: true });
  };
  return (
    <Surface mode="incognito" className="absolute inset-0">
      {accepted ? (
        <MineScreen onBack={back} />
      ) : (
        <Screen header={<PageHeader title="My buzzes" mode="compact" back={back} />}>
          <BuzzGatePanel variant="page" onDismiss={back} className="pt-4" />
        </Screen>
      )}
    </Surface>
  );
};

const MineScreen: FC<{ onBack(): void }> = ({ onBack }) => {
  const [kind, setKind] = useState<MyBuzzKind>('threads');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const list = useMyBuzzes(kind);
  const karma = useBuzzKarma();
  const openComposer = useBuzzStore((s) => s.openComposer);
  const gateError = isApiError(list.error, 'buzz_gate_required');

  return (
    <Screen
      scrollRef={scrollRef}
      header={
        <PageHeader
          title="My buzzes"
          subtitle={karma.data ? `Your buzz karma: ${karma.data.karma}` : 'Only you can ever see this list.'}
          mode="compact"
          back={onBack}
          below={
            <Tabs<MyBuzzKind>
              aria-label="My buzzes"
              value={kind}
              onChange={setKind}
              tabs={[
                { value: 'threads', label: 'Threads' },
                { value: 'replies', label: 'Replies' },
              ]}
            />
          }
        />
      }
    >
      <p className="px-4 pt-3 pb-2 type-caption text-ink-3">
        <VenetianMask size={12} aria-hidden className="mr-1 inline-block align-[-2px]" />
        Private. Karma is the sum of your scores and is never shown to anyone else.
      </p>
      {list.isLoading ? (
        <div className="flex flex-col gap-3 px-4" aria-busy>
          <BuzzCardSkeleton />
          <BuzzCardSkeleton />
        </div>
      ) : list.isError && !gateError ? (
        <ErrorState title="Buzz didn't load. That's on us." error={list.error} onRetry={() => void list.refetch()} className="px-4" />
      ) : list.items.length === 0 ? (
        <EmptyState
          icon={VenetianMask}
          title="You haven't buzzed yet."
          description="Only you can ever see this list."
          action={{ label: 'Write a buzz', onClick: () => openComposer() }}
          compact
          className="pt-4"
        />
      ) : (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {list.items.map((m: MyBuzzItem) =>
            m.item.kind === 'buzz' ? (
              <BuzzCard key={m.item.id} buzz={m.item} />
            ) : (
              <MyReplyCard key={m.item.id} reply={m.item} snippet={m.threadSnippet} />
            ),
          )}
          <InfiniteSentinel {...list.sentinelProps} rootRef={scrollRef} skeleton={<BuzzCardSkeleton />} endLabel="That's all of yours" />
        </div>
      )}
      <BuzzComposer />
    </Screen>
  );
};

const MyReplyCard: FC<{ reply: BuzzReply; snippet: string }> = ({ reply, snippet }) => {
  const navigate = useNavigate();
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-4" aria-label="Your reply">
      <button type="button" className="flex flex-col gap-1 text-left" onClick={() => navigate(routes.buzzThread(reply.threadId))}>
        <span className="type-caption text-ink-3">Replying in</span>
        <span className="line-clamp-2 type-footnote text-ink-2">{snippet || '[thread unavailable]'}</span>
      </button>
      <AliasLine alias={reply.alias} isMine={reply.isMine} isOp={reply.isOp} createdAt={reply.createdAt} trailing={<ContentStatusChip status={reply.status} />} />
      <BuzzText text={reply.text} status={reply.status} clamp />
      <footer className="flex items-center">
        <VoteCluster item={reply} />
      </footer>
    </article>
  );
};

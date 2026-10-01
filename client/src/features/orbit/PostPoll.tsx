/**
 * Poll block: before voting the options are buttons; after (or for the author) they are result bars filling
 * `accent-soft` with tabular percentages. One vote, no change (server rule).
 */
import { useState, type FC } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { PostPoll as PostPollType } from '@shared/orbit';
import { cn } from '@/lib/cn';
import { errorMessage, isApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { patchPost, votePollRequest } from './api';

export interface PostPollProps {
  postId: string;
  poll: PostPollType;
  isSelf: boolean;
  className?: string;
}

export const PostPoll: FC<PostPollProps> = ({ postId, poll, isSelf, className }) => {
  const [pending, setPending] = useState<string | null>(null);
  const vote = useMutation({
    mutationFn: (optionId: string) => votePollRequest(postId, optionId),
    onMutate: (optionId) => setPending(optionId),
    onSuccess: (next) => patchPost(postId, (p) => ({ ...p, poll: next })),
    onError: (e) => {
      if (isApiError(e, 'conflict')) toast.info("You've already voted in this poll.");
      else toast.error(errorMessage(e));
    },
    onSettled: () => setPending(null),
  });

  const showResults = isSelf || poll.myChoice !== null;
  const total = poll.totalVotes;

  return (
    <div className={cn('flex flex-col gap-2', className)} onClick={(e) => e.stopPropagation()} role="group" aria-label="Poll">
      {poll.options.map((o) => {
        const mine = poll.myChoice === o.id;
        if (showResults) {
          return (
            <div
              key={o.id}
              className={cn('relative flex min-h-11 items-center overflow-hidden rounded-md bg-surface-2 px-3.5', mine && 'ring-1 ring-accent-line')}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 bg-accent-soft transition-[width] duration-500 ease-out" style={{ width: `${o.pct}%` }} />
              <span className="relative flex min-w-0 flex-1 items-center gap-2 type-body text-ink">
                <span className="truncate">{o.text}</span>
                {mine ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-accent-ink" aria-label="Your vote" /> : null}
              </span>
              <span className="relative ml-3 shrink-0 type-label-sm tabular-nums text-ink-2">{o.pct}%</span>
            </div>
          );
        }
        return (
          <button
            key={o.id}
            type="button"
            disabled={vote.isPending}
            onClick={() => vote.mutate(o.id)}
            aria-busy={pending === o.id}
            className={cn(
              'press flex min-h-11 items-center rounded-md border border-accent-line bg-transparent px-3.5 text-left type-label text-accent-ink',
              'hover:bg-accent-soft disabled:opacity-60',
            )}
          >
            <span className="truncate">{o.text}</span>
          </button>
        );
      })}
      <span className="type-caption text-ink-3">
        {total === 1 ? '1 vote' : `${total} votes`}
        {!showResults ? ' · Vote to see results' : ''}
      </span>
    </div>
  );
};

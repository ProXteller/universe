/**
 * Appeals (safety §4.5): reviewed blind — the sanction, the appealed content and the appeal text, never a user.
 * `canReview` comes from the server (reviewer ≠ actor; suspensions / bans admin only).
 */
import { useState, type FC } from 'react';
import { Scale } from 'lucide-react';
import { CATEGORY_LABELS } from '@shared/core';
import type { AppealOutcome, StaffAppeal } from '@shared/admin';
import { SANCTION_KIND_LABELS } from '@shared/admin';
import { Badge, Button, Card, ChipGroup, EmptyState, ErrorState, InfiniteSentinel, SegmentedControl, Select, Sheet, Textarea, type SelectOption } from '@/ui';
import { ComposerModeBanner, TimeAgo } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { formatDayTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useAppeals, useDecideAppeal } from './api';
import { ExcerptBlock, RowSkeleton } from './parts';
import { AdminShell } from './shell';

type Status = 'open' | 'upheld' | 'reversed' | 'reduced';
const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'upheld', label: 'Upheld' },
  { value: 'reversed', label: 'Reversed' },
  { value: 'reduced', label: 'Reduced' },
] as const satisfies readonly { value: Status; label: string }[];
const OUTCOME_OPTIONS = [
  { value: 'upheld', label: 'Uphold' },
  { value: 'reduced', label: 'Reduce' },
  { value: 'reversed', label: 'Reverse' },
] as const satisfies readonly { value: AppealOutcome; label: string }[];
const HOUR = 60 * 60_000;
const REDUCE_OPTIONS: readonly SelectOption<string>[] = [
  { value: String(HOUR), label: 'Ends in 1 hour' },
  { value: String(6 * HOUR), label: 'Ends in 6 hours' },
  { value: String(24 * HOUR), label: 'Ends in 24 hours' },
  { value: String(72 * HOUR), label: 'Ends in 3 days' },
];

const AppealCard: FC<{ a: StaffAppeal; onReview(): void }> = ({ a, onReview }) => (
  <Card className="p-3">
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="soft" tone={a.sanction.kind === 'ban' || a.sanction.kind === 'suspension' ? 'danger' : 'warning'}>{SANCTION_KIND_LABELS[a.sanction.kind]}</Badge>
      <Badge variant="outline" tone={a.sanction.origin === 'anon' ? 'info' : 'neutral'}>{a.sanction.origin === 'anon' ? 'Buzz origin' : 'Public origin'}</Badge>
      {a.sanction.category ? <span className="type-caption text-ink-2">{CATEGORY_LABELS[a.sanction.category]}</span> : null}
      <span className="ml-auto type-caption text-ink-3"><TimeAgo ts={a.createdAt} /></span>
    </div>
    {a.contentExcerpt ? (
      <div className="mt-2">
        <div className="mb-1 type-caption text-ink-3">Appealed {a.contentLabel ?? 'content'}</div>
        <ExcerptBlock text={a.contentExcerpt} anon={a.sanction.origin === 'anon'} />
      </div>
    ) : null}
    <p className="mt-2 type-footnote text-ink">"{a.text}"</p>
    <div className="mt-2 flex items-center gap-2 type-caption text-ink-3">
      <span>{a.sanction.until ? `Sanction until ${formatDayTime(a.sanction.until)}` : 'No end time'}</span>
      {a.status !== 'open' ? <Badge variant="outline" tone={a.status === 'upheld' ? 'neutral' : 'success'}>{a.status}</Badge> : null}
      {a.status === 'open' ? (
        <span className="ml-auto">
          {a.canReview ? (
            <Button size="sm" onClick={onReview}>
              Review
            </Button>
          ) : (
            <span>Not yours to review</span>
          )}
        </span>
      ) : null}
    </div>
  </Card>
);

export const AppealsPage: FC = () => {
  const [status, setStatus] = useState<Status>('open');
  const list = useAppeals(status);
  const decide = useDecideAppeal();
  const [reviewing, setReviewing] = useState<StaffAppeal | null>(null);
  const [outcome, setOutcome] = useState<AppealOutcome>('upheld');
  const [note, setNote] = useState('');
  const [reduceMs, setReduceMs] = useState<string>(String(24 * HOUR));
  useScreenView('admin_appeals', { status });

  const valid = note.trim().length >= 10;
  const submit = (): void => {
    if (!reviewing) return;
    decide.mutate(
      { id: reviewing.id, outcome, note: note.trim(), reducedUntil: outcome === 'reduced' ? Date.now() + Number(reduceMs) : undefined },
      {
        onSuccess: () => {
          toast.success(`Appeal ${outcome}`);
          setReviewing(null);
          setNote('');
        },
      },
    );
  };

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {Array.from({ length: 3 }, (_, i) => (
          <RowSkeleton key={i} lines={3} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState title="Couldn't load appeals" error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = <EmptyState icon={Scale} title={status === 'open' ? 'No open appeals.' : `No ${status} appeals.`} description="Appeals are reviewed by someone other than the person who acted." compact />;
  } else {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {list.items.map((a) => (
          <AppealCard key={a.id} a={a} onReview={() => { setReviewing(a); setOutcome('upheld'); setNote(''); }} />
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton lines={3} />} endLabel={null} />
      </div>
    );
  }

  return (
    <AdminShell tab="appeals">
      <div className="px-4">
        <ChipGroup<Status> options={STATUS_OPTIONS} value={status} onChange={(v: Status) => setStatus(v)} scroll="x" size="sm" aria-label="Appeal status" />
      </div>
      {body}
      <Sheet
        open={reviewing !== null}
        onOpenChange={(o) => { if (!o) setReviewing(null); }}
        title="Decide appeal"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setReviewing(null)}>
              Cancel
            </Button>
            <Button fullWidth disabled={!valid} loading={decide.isPending} onClick={submit}>
              Submit decision
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ComposerModeBanner mode="public" verb="Deciding" size="inline" note="The outcome notifies the appellant and is audited." />
          <SegmentedControl<AppealOutcome> value={outcome} onChange={setOutcome} options={OUTCOME_OPTIONS} fullWidth size="sm" aria-label="Outcome" />
          <p className="type-caption text-ink-3">
            {outcome === 'upheld' ? 'The decision stands.' : outcome === 'reversed' ? 'Content restored, strike removed, sanction lifted immediately.' : 'Same sanction, shorter.'}
          </p>
          {outcome === 'reduced' ? <Select<string> label="New end time" value={reduceMs} onChange={setReduceMs} options={REDUCE_OPTIONS} /> : null}
          <Textarea label="Note (≥ 10 characters, staff only)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} minRows={2} />
        </div>
      </Sheet>
    </AdminShell>
  );
};

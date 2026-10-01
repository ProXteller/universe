/**
 * ReportSheet + its host (SPEC §4.4.2, safety §3.1). Reason radio list → optional details → submitted state.
 * Works in both surface modes: the host re-stamps the caller's mode captured by `openReport(target, mode)`.
 */
import { forwardRef, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Flag, ShieldCheck } from 'lucide-react';
import {
  LIMITS,
  LISTING_REPORT_SUBREASONS,
  REPORT_REASONS,
  type CreateReportRequest,
  type ListingReportSubReason,
  type ReportReason,
  type ReportReceipt,
  type ReportTarget,
} from '@shared/core';
import { Button, Sheet, Surface, Switch, Textarea, type SurfaceMode } from '@/ui';
import { cn } from '@/lib/cn';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { handleModerationError } from '@/lib/moderation';
import { openBlock } from '@/lib/report';
import { useMeOptional } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useUiStore } from '@/stores/ui';

export interface ReportSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  target: ReportTarget;
  className?: string;
}

const LISTING_TYPES = new Set<ReportTarget['entityType']>(['market_listing', 'roommate_listing']);
const CONTEXT_TYPES = new Set<ReportTarget['entityType']>(['message', 'conversation']);
const MIN_OTHER_NOTE = 10;

function RadioRow({ selected, label, onSelect }: { selected: boolean; label: string; onSelect(): void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 px-4 text-left type-body transition-colors duration-150',
        selected ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-surface-4',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
          selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong',
        )}
      >
        {selected ? <Check size={12} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  );
}

/** Reason list → optional note (required for "Something else") → "Thanks…" + Block for public authors. */
export const ReportSheet = forwardRef<HTMLDivElement, ReportSheetProps>(function ReportSheet(
  { open, onOpenChange, target, className },
  ref,
) {
  const me = useMeOptional();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [subReason, setSubReason] = useState<ListingReportSubReason | null>(null);
  const [note, setNote] = useState('');
  const [includeContext, setIncludeContext] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason(null);
    setSubReason(null);
    setNote('');
    setIncludeContext(false);
    setDone(false);
  }, [open, target.entityType, target.entityId]);

  const isListing = LISTING_TYPES.has(target.entityType);
  const hasContext = CONTEXT_TYPES.has(target.entityType);
  const needsNote = reason === 'other';
  const noteTooShort = needsNote && note.trim().length < MIN_OTHER_NOTE;
  const author = target.author && me && target.author.id !== me.id ? target.author : null;

  const mutation = useMutation<ReportReceipt, unknown, CreateReportRequest>({
    mutationFn: (body) => api.post<ReportReceipt>('/reports', body),
    onSuccess: (receipt) => {
      setDone(true);
      track('report_submitted', { entityType: receipt.entityType, reason: receipt.reason, repeat: receipt.alreadyReported });
      target.onReported?.();
    },
    onError: (e) => {
      if (!handleModerationError(e)) toast.error(errorMessage(e));
    },
  });

  const submit = () => {
    if (!reason || noteTooShort || mutation.isPending) return;
    const body: CreateReportRequest = { entityType: target.entityType, entityId: target.entityId, reason };
    if (isListing && reason === 'spam_scam' && subReason) body.subReason = subReason;
    if (note.trim()) body.note = note.trim().slice(0, LIMITS.reportNote);
    if (hasContext) body.includeContext = includeContext;
    mutation.mutate(body);
  };

  const close = () => onOpenChange(false);

  if (done) {
    return (
      <Sheet ref={ref} open={open} onOpenChange={onOpenChange} title="Report sent" className={className}>
        <div className="flex flex-col items-center gap-4 pb-2 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <ShieldCheck size={26} strokeWidth={1.75} aria-hidden />
          </span>
          <p className="type-body text-ink-2">Thanks. Our safety team will take a look. You won't see this again.</p>
          <div className="flex w-full flex-col gap-2">
            {author ? (
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => {
                  close();
                  openBlock(author);
                }}
              >
                Block @{author.handle}
              </Button>
            ) : null}
            <Button size="lg" fullWidth onClick={close}>
              Done
            </Button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      title="Report"
      description="What's wrong with this? Reports are anonymous."
      detents={['auto']}
      className={className}
      footer={
        <Button size="lg" fullWidth leftIcon={Flag} disabled={!reason || noteTooShort} loading={mutation.isPending} onClick={submit}>
          Send report
        </Button>
      }
    >
      <div role="radiogroup" aria-label="Reason" className="overflow-hidden rounded-lg border border-line bg-surface-3">
        {REPORT_REASONS.map((r, i) => (
          <div key={r.id} className={cn(i > 0 && 'border-t border-line-subtle')}>
            <RadioRow selected={reason === r.id} label={r.label} onSelect={() => setReason(r.id)} />
          </div>
        ))}
      </div>

      {isListing && reason === 'spam_scam' ? (
        <div role="radiogroup" aria-label="Details" className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-3">
          {LISTING_REPORT_SUBREASONS.map((s, i) => (
            <div key={s.id} className={cn(i > 0 && 'border-t border-line-subtle')}>
              <RadioRow selected={subReason === s.id} label={s.label} onSelect={() => setSubReason(s.id)} />
            </div>
          ))}
        </div>
      ) : null}

      {reason ? (
        <Textarea
          label={needsNote ? 'Tell us more' : 'Anything else? (optional)'}
          placeholder={needsNote ? 'What happened? At least 10 characters.' : 'Add context for the safety team'}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={LIMITS.reportNote}
          minRows={2}
          maxRows={5}
          error={needsNote && note.length > 0 && noteTooShort ? 'A few more words help us act on this.' : undefined}
          className="mt-3"
        />
      ) : null}

      {hasContext ? (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3.5 py-3">
          <p id="report-context-label" className="min-w-0 flex-1 type-footnote text-ink-2">
            The last few messages in this chat will be shared with our safety team.
          </p>
          <Switch checked={includeContext} onChange={setIncludeContext} aria-labelledby="report-context-label" />
        </div>
      ) : null}
    </Sheet>
  );
});

/** Mounted once by AppShell. Renders the sheet inside the caller's surface mode. */
export function ReportHost() {
  const request = useUiStore((s) => s.report);
  const closeReport = useUiStore((s) => s.closeReport);
  // Keep the last request mounted while the sheet animates out.
  const [last, setLast] = useState(request);
  useEffect(() => {
    if (request) setLast(request);
  }, [request]);
  const current = request ?? last;
  if (!current) return null;
  const mode: SurfaceMode = current.mode;
  return (
    <Surface mode={mode} style={{ display: 'contents', backgroundColor: 'transparent' }}>
      <ReportSheet open={request !== null} onOpenChange={(o) => (o ? undefined : closeReport())} target={current.target} />
    </Surface>
  );
}

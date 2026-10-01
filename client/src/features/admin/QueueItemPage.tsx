/**
 * Item detail (safety §6.3): content with matched spans, media, rule hits, signals, context (Buzz: blind thread context;
 * messages: the reported window), reports, history, author panel (public profile or the blind bucketed standing),
 * suggestion, the action sheet (ladder per role) and — admins on anon items only — the unmask ritual with a 5-minute
 * on-screen re-mask (product §2.11, safety §6.5).
 */
import { useEffect, useMemo, useState, type FC, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Eye, EyeOff, Gavel, Lock, Sparkles } from 'lucide-react';
import type { ModerationCategory } from '@shared/core';
import { CATEGORY_LABELS, REPORT_REASONS } from '@shared/core';
import type { StaffAction, StaffQueueItemDetail, UnmaskReasonCode, UnmaskResponse } from '@shared/admin';
import { SANCTION_KIND_LABELS, STAFF_ACTIONS, UNMASK_REASON_CODES, UNMASK_REASON_LABELS, UNMASK_REASON_MIN } from '@shared/admin';
import { Badge, Button, Card, Dialog, ErrorState, Input, Select, Sheet, Skeleton, SkeletonText, Switch, Textarea, type SelectOption } from '@/ui';
import { ComposerModeBanner, MediaBox, TimeAgo, UserRow } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatDayTime } from '@/lib/format';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useClaim, useQueueAction, useQueueItem, useUnmask } from './api';
import { BlindNote, ExcerptBlock, HighlightedText, KeyValue, PRIORITY_TONE, ROLE_TONE, Section, SOURCE_LABEL, SURFACE_LABEL, SlaChip, StatusChip, categoryLabel, useNowTick } from './parts';
import { AdminShell } from './shell';

const CATEGORY_OPTIONS: readonly SelectOption<ModerationCategory>[] = (Object.keys(CATEGORY_LABELS) as ModerationCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const REASON_OPTIONS: readonly SelectOption<UnmaskReasonCode>[] = UNMASK_REASON_CODES.map((c) => ({ value: c, label: UNMASK_REASON_LABELS[c] }));
const REPORT_LABEL = new Map(REPORT_REASONS.map((r) => [r.id, r.label]));

/* ------------------------------------------------------------------ context renderers (defensive: the shape is the owner slice's) */

interface BuzzLike {
  text?: unknown;
  alias?: { label?: unknown } | null;
}
function buzzText(x: unknown): { text: string; alias: string | null } | null {
  if (!x || typeof x !== 'object') return null;
  const b = x as BuzzLike;
  if (typeof b.text !== 'string') return null;
  const alias = b.alias && typeof b.alias === 'object' && typeof b.alias.label === 'string' ? b.alias.label : null;
  return { text: b.text, alias };
}

const BuzzContext: FC<{ context: Record<string, unknown>; entityId: string | null }> = ({ context }) => {
  const root = buzzText(context.root);
  const parents = Array.isArray(context.parents) ? context.parents.map(buzzText).filter((x): x is NonNullable<typeof x> => x !== null) : [];
  const siblings = Array.isArray(context.siblings) ? context.siblings.map(buzzText).filter((x): x is NonNullable<typeof x> => x !== null) : [];
  if (!root && parents.length === 0 && siblings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {root && context.entityType === 'buzz_reply' ? (
        <div>
          <div className="mb-1 type-caption text-ink-3">Thread root</div>
          <ExcerptBlock text={root.text} anon aliasLabel={root.alias} />
        </div>
      ) : null}
      {parents.length ? (
        <div className="flex flex-col gap-1">
          <div className="type-caption text-ink-3">Parent chain</div>
          {parents.map((p, i) => (
            <ExcerptBlock key={i} text={p.text} anon aliasLabel={p.alias} />
          ))}
        </div>
      ) : null}
      {siblings.length ? (
        <div className="flex flex-col gap-1">
          <div className="type-caption text-ink-3">Nearby replies</div>
          {siblings.map((p, i) => (
            <ExcerptBlock key={i} text={p.text} anon aliasLabel={p.alias} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

interface WindowMessage {
  id?: unknown;
  kind?: unknown;
  text?: unknown;
  status?: unknown;
  createdAt?: unknown;
}
const MessageWindow: FC<{ messages: unknown[]; entityId: string | null }> = ({ messages, entityId }) => (
  <div className="flex flex-col gap-1">
    <div className="type-caption text-ink-3">Reported message and up to 10 before it (viewing is audited)</div>
    {messages.map((m, i) => {
      const w = (m ?? {}) as WindowMessage;
      const mine = typeof w.id === 'string' && w.id === entityId;
      return (
        <div key={i} className={mine ? 'rounded-md border border-warning bg-warning-soft p-2' : 'rounded-md bg-surface-2 p-2'}>
          <div className="flex items-center gap-2 type-caption text-ink-3">
            <span>{typeof w.kind === 'string' ? w.kind : 'message'}</span>
            {mine ? <Badge variant="soft" tone="warning">Reported</Badge> : null}
            {typeof w.createdAt === 'number' ? <span className="ml-auto"><TimeAgo ts={w.createdAt} /></span> : null}
          </div>
          <p className="type-footnote whitespace-pre-wrap break-words text-ink">{typeof w.text === 'string' && w.text ? w.text : <span className="text-ink-3">(no text)</span>}</p>
        </div>
      );
    })}
  </div>
);

/* ------------------------------------------------------------------ unmask result panel */

const UnmaskPanel: FC<{ result: UnmaskResponse; onRemask(): void }> = ({ result, onRemask }) => {
  const nowMs = useNowTick(1000);
  const left = Math.max(0, result.expiresAt - nowMs);
  const mm = Math.floor(left / 60_000);
  const ss = Math.floor((left % 60_000) / 1000);
  return (
    <Card variant="raised" className="border-warning bg-warning-soft p-3">
      <div className="mb-2 flex items-center gap-2">
        <Eye className="size-4 text-warning" aria-hidden />
        <span className="type-label-sm text-ink">Unmasked · re-masks in {mm}:{String(ss).padStart(2, '0')}</span>
        <Button size="sm" variant="ghost" leftIcon={EyeOff} className="ml-auto" onClick={onRemask}>
          Re-mask now
        </Button>
      </div>
      <KeyValue
        rows={[
          { k: 'Name', v: result.user.displayName },
          { k: 'Handle', v: `@${result.user.handle}` },
          { k: 'Email', v: result.user.email },
          { k: 'User id', v: <span className="font-mono">{result.user.id}</span> },
          { k: 'Audit id', v: <span className="font-mono">{result.unmaskId}</span> },
        ]}
      />
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="secondary" to={routes.adminUser(result.user.id)}>
          Open account
        </Button>
      </div>
    </Card>
  );
};

/* ------------------------------------------------------------------ the page */

export const QueueItemPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const me = useMe();
  const navigate = useNavigate();
  const item = useQueueItem(id || undefined);
  const action = useQueueAction(id);
  const claim = useClaim(id);
  useScreenView('admin_queue_item');

  // action sheet
  const [sheet, setSheet] = useState(false);
  const [act, setAct] = useState<StaffAction | null>(null);
  const [category, setCategory] = useState<ModerationCategory | null>(null);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [badFaith, setBadFaith] = useState(false);
  // unmask
  const [unmaskOpen, setUnmaskOpen] = useState(false);
  const [reasonCode, setReasonCode] = useState<UnmaskReasonCode | null>(null);
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [unmaskConfirm, setUnmaskConfirm] = useState('');
  const [unmasked, setUnmasked] = useState<UnmaskResponse | null>(null);
  const d = item.data;
  // blocked text never became an entity: the unmask endpoint then takes the queue item id (polish P6)
  const unmask = useUnmask(d?.entityType === 'buzz_reply' ? 'buzz_reply' : 'buzz', d?.entityId ?? d?.id ?? '');

  useEffect(() => {
    if (!unmasked) return;
    const t = window.setTimeout(() => setUnmasked(null), Math.max(0, unmasked.expiresAt - Date.now()));
    return () => window.clearTimeout(t);
  }, [unmasked]);
  useEffect(() => {
    if (d && category === null && d.category) setCategory(d.category);
  }, [d, category]);

  const actions = useMemo(() => STAFF_ACTIONS.filter((a) => a.role === 'mod' || me.role === 'admin'), [me.role]);
  const def = actions.find((a) => a.id === act) ?? null;
  const openAction = (preset: StaffAction | null): void => {
    setAct(preset ?? (d?.suggestion?.action ?? 'approve'));
    setNote('');
    setReference('');
    setConfirmText('');
    setBadFaith(false);
    setSheet(true);
  };
  const noteOk = !def?.needsNote || note.trim().length >= (act === 'ban' ? 30 : 10);
  const banOk = act !== 'ban' || confirmText === 'BAN';
  const refOk = act !== 'escalate_external' || reference.trim().length > 0;
  const canSubmit = Boolean(def && category) && noteOk && banOk && refOk;
  const submit = (): void => {
    if (!def || !category) return;
    action.mutate(
      { action: def.id, category, note: note.trim() || undefined, reference: reference.trim() || undefined, confirmText: confirmText || undefined, badFaith: badFaith || undefined },
      {
        onSuccess: () => {
          toast.success(`${def.label} · logged`);
          setSheet(false);
        },
      },
    );
  };
  const unmaskValid = reasonCode !== null && reason.trim().length >= UNMASK_REASON_MIN && unmaskConfirm === 'UNMASK';
  const runUnmask = async (): Promise<void> => {
    if (!reasonCode) return;
    try {
      const res = await unmask.mutateAsync({ reasonCode, reason: reason.trim(), confirmText: 'UNMASK', caseRef: caseRef.trim() || undefined });
      setUnmasked(res);
      setReason('');
      setCaseRef('');
      setUnmaskConfirm('');
      toast.success('Unmasked and logged');
    } catch (e) {
      toast.error(errorMessage(e));
      throw e;
    }
  };

  let body: ReactNode;
  if (item.isLoading) {
    body = (
      <div className="flex flex-col gap-3 px-4">
        <div className="flex gap-2">
          <Skeleton w={40} h={18} />
          <Skeleton w={80} h={18} />
        </div>
        <div className="rounded-md bg-surface-2 p-3">
          <SkeletonText lines={3} />
        </div>
        <SkeletonText lines={4} />
      </div>
    );
  } else if (item.isError || !d) {
    body = <ErrorState title="Couldn't load this item" error={item.error} onRetry={() => void item.refetch()} />;
  } else {
    body = <Detail d={d} me={me} onAction={openAction} onUnmask={() => setUnmaskOpen(true)} unmasked={unmasked} onRemask={() => setUnmasked(null)} claim={claim} navigate={navigate} />;
  }

  return (
    <AdminShell tab="queue" title="Queue item" detail>
      {body}

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Take action"
        detents={['full']}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant={def?.destructive ? 'danger' : 'primary'} fullWidth disabled={!canSubmit} loading={action.isPending} onClick={submit}>
              {def?.label ?? 'Apply'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ComposerModeBanner mode="public" verb="Acting" size="inline" note="Written to the append-only audit log." />
          {d?.anon ? <BlindNote /> : null}
          <Select<StaffAction>
            label="Action"
            value={act}
            onChange={setAct}
            options={actions.map((a) => ({ value: a.id, label: a.label, description: a.detail }))}
            sheetTitle="Sanctions ladder"
          />
          <Select<ModerationCategory> label="Guideline" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} placeholder="Pick the guideline" />
          {def ? (
            <Textarea
              label={def.needsNote ? `Note (required, ≥ ${act === 'ban' ? 30 : 10} characters, staff only)` : 'Note (optional, staff only)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              minRows={2}
              helper={d?.anon ? 'Do not write a name or handle here.' : undefined}
            />
          ) : null}
          {act === 'escalate_external' ? <Input label="Outside reference number" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} /> : null}
          {act === 'ban' ? <Input label="Type BAN to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoCapitalize="characters" /> : null}
          {act === 'dismiss_reports' ? (
            <div className="flex items-center justify-between rounded-md bg-surface-2 p-3">
              <span className="type-footnote text-ink">Mark as bad-faith reports</span>
              <Switch checked={badFaith} onChange={setBadFaith} aria-label="Mark as bad-faith reports" />
            </div>
          ) : null}
        </div>
      </Sheet>

      <Dialog
        open={unmaskOpen}
        onOpenChange={setUnmaskOpen}
        title="Unmask this author?"
        icon={Eye}
        tone="danger"
        persistent
        description="Only for a credible threat, a risk to life, child safety, severe or repeated harassment, a valid legal request or ban evasion. Every unmask is permanently logged and every other admin is alerted. The identity re-masks on screen after five minutes."
        confirmLabel="Unmask and log"
        confirmDisabled={!unmaskValid}
        onConfirm={runUnmask}
      >
        <div className="flex flex-col gap-3">
          <ComposerModeBanner mode="public" verb="Unmasking" size="inline" />
          <Select<UnmaskReasonCode> label="Reason code" value={reasonCode} onChange={setReasonCode} options={REASON_OPTIONS} placeholder="Pick a reason code" />
          <Textarea label={`Written reason (≥ ${UNMASK_REASON_MIN} characters)`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} minRows={3} />
          <Input label="Case reference (optional)" value={caseRef} onChange={(e) => setCaseRef(e.target.value)} maxLength={100} />
          <Input label="Type UNMASK to confirm" value={unmaskConfirm} onChange={(e) => setUnmaskConfirm(e.target.value)} autoCapitalize="characters" />
        </div>
      </Dialog>
    </AdminShell>
  );
};

/* ------------------------------------------------------------------ detail body */

interface DetailProps {
  d: StaffQueueItemDetail;
  me: ReturnType<typeof useMe>;
  onAction(preset: StaffAction | null): void;
  onUnmask(): void;
  unmasked: UnmaskResponse | null;
  onRemask(): void;
  claim: ReturnType<typeof useClaim>;
  navigate: ReturnType<typeof useNavigate>;
}

const Detail: FC<DetailProps> = ({ d, me, onAction, onUnmask, unmasked, onRemask, claim, navigate }) => {
  const ctx = d.context && typeof d.context === 'object' ? (d.context as Record<string, unknown>) : null;
  const open = d.status !== 'closed';
  return (
    <div className="flex flex-col gap-4 px-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="soft" tone={PRIORITY_TONE[d.priority]}>{d.priority.toUpperCase()}</Badge>
        <Badge variant="outline">{SURFACE_LABEL[d.surface]}</Badge>
        {d.label === 'wellbeing' ? <Badge variant="soft" tone="info">Wellbeing</Badge> : null}
        <Badge variant="outline">{SOURCE_LABEL[d.source] ?? d.source}</Badge>
        <span className="type-caption text-ink-2">{categoryLabel(d.category)}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <SlaChip item={d} />
          <StatusChip item={d} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 type-caption text-ink-3">
        <span>{d.universityShortName}</span>
        <span>· created <TimeAgo ts={d.createdAt} /></span>
        {d.closedAt ? <span>· closed <TimeAgo ts={d.closedAt} /></span> : null}
        {d.contentStatus ? <Badge variant="outline" tone={d.contentStatus === 'active' ? 'success' : 'warning'}>{d.contentStatus}</Badge> : null}
        <span className="ml-auto font-mono">{d.id}</span>
      </div>

      {d.anon ? <BlindNote /> : null}
      {unmasked ? <UnmaskPanel result={unmasked} onRemask={onRemask} /> : null}

      <Section title="Content" hint={d.fields.length ? `${d.fields.length} ${d.fields.length === 1 ? 'field' : 'fields'}` : undefined}>
        {d.fields.length === 0 ? <p className="type-footnote text-ink-3">No text on this item.</p> : null}
        {d.fields.map((f) => (
          <div key={f.field}>
            {d.fields.length > 1 ? <div className="mb-1 type-caption text-ink-3">{f.field}</div> : null}
            <ExcerptBlock text={f.text} anon={d.anon} spans={f.spans} />
          </div>
        ))}
        {d.media.length ? (
          <div className="grid grid-cols-3 gap-2">
            {d.media.map((m, i) =>
              m.kind === 'image' ? (
                <MediaBox key={i} src={m.url} alt={`Attachment ${i + 1}`} aspect="1:1" rounded="sm" />
              ) : (
                <video key={i} src={m.url} controls preload="metadata" className="aspect-square w-full rounded-sm bg-surface-2" aria-label={`Video attachment ${i + 1}`} />
              ),
            )}
          </div>
        ) : null}
      </Section>

      {(d.ruleHits.length || d.signals) && (
        <Section title="Engine">
          {d.ruleHits.length ? (
            <div className="flex flex-wrap gap-1.5">
              {d.ruleHits.map((h) => (
                <Badge key={`${h.ruleId}:${h.subcode}`} variant="outline" tone={h.severity === 'critical' || h.severity === 'high' ? 'danger' : h.severity === 'medium' ? 'warning' : 'neutral'}>
                  <span className="font-mono">{h.ruleId}</span>
                  <span className="ml-1 text-ink-3">{h.subcode}</span>
                </Badge>
              ))}
            </div>
          ) : null}
          {d.signals ? (
            <KeyValue
              rows={[
                { k: 'Severity', v: d.severity },
                { k: 'Evasion', v: d.signals.evasion ? 'yes' : 'no' },
                { k: 'Signals', v: `${d.signals.urls} urls · ${d.signals.mentions} mentions · caps ${Math.round(d.signals.capsRatio * 100)}% · ${d.signals.homoglyphs} homoglyphs · ${d.signals.invisibleChars} invisible` },
                ...(d.aiVerdict ? [{ k: 'AI verdict', v: <span className="font-mono break-all">{JSON.stringify(d.aiVerdict)}</span> }] : []),
              ]}
            />
          ) : null}
        </Section>
      )}

      {ctx ? (
        <Section title="Context">
          {d.anon ? <BuzzContext context={ctx} entityId={d.entityId} /> : Array.isArray(ctx.messages) ? <MessageWindow messages={ctx.messages} entityId={d.entityId} /> : <p className="type-footnote text-ink-3">No context for this surface.</p>}
        </Section>
      ) : null}

      <Section title="Reports" hint={`${d.reports.length}`}>
        {d.reports.length === 0 ? <p className="type-footnote text-ink-3">No reports on this item.</p> : null}
        {d.reports.map((r) => (
          <Card key={r.id} className="p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="soft" tone="neutral">{REPORT_LABEL.get(r.reason) ?? r.reason}</Badge>
              {r.subReason ? <span className="type-caption text-ink-3">{r.subReason}</span> : null}
              <Badge variant="outline" tone={r.reporterTrust === 'high' ? 'success' : r.reporterTrust === 'low' ? 'warning' : 'neutral'}>trust {r.reporterTrust}</Badge>
              <span className="ml-auto type-caption text-ink-3"><TimeAgo ts={r.createdAt} /></span>
            </div>
            {r.note ? <p className="mt-2 type-footnote text-ink-2">"{r.note}"</p> : null}
            {r.reporter ? <div className="mt-2"><UserRow user={r.reporter} size="md" trailing="none" onClick={() => navigate(routes.adminUser(r.reporter!.id))} /></div> : null}
          </Card>
        ))}
      </Section>

      <Section title="Author">
        {d.author.kind === 'public' ? (
          <Card className="p-3">
            <UserRow user={d.author.user} trailing="none" onClick={() => navigate(routes.adminUser(d.author.kind === 'public' ? d.author.user.id : ''))} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline">{d.author.accountAgeDays}d old</Badge>
              <Badge variant="outline" tone={d.author.strikePoints ? 'warning' : 'neutral'}>{d.author.strikePoints} strike pts</Badge>
              {d.author.sanctions.slice(0, 4).map((s) => (
                <Badge key={s.id} variant="soft" tone={s.kind === 'ban' || s.kind === 'suspension' ? 'danger' : 'neutral'}>{SANCTION_KIND_LABELS[s.kind]}{s.until ? ` · until ${formatDayTime(s.until)}` : ''}</Badge>
              ))}
            </div>
          </Card>
        ) : (
          <Card className="p-3">
            <div className="mb-2 type-caption text-ink-3">Blind standing · bucketed, no identifier of any kind</div>
            <KeyValue
              rows={[
                { k: 'Account age', v: d.author.accountAge },
                { k: 'Strike points', v: d.author.strikePoints },
                { k: 'Prior by guideline', v: Object.keys(d.author.priorByCategory).length ? Object.entries(d.author.priorByCategory).map(([c, n]) => `${CATEGORY_LABELS[c as ModerationCategory] ?? c} ${n}`).join(' · ') : 'none' },
                { k: 'Current sanction', v: d.author.sanction ? SANCTION_KIND_LABELS[d.author.sanction] : 'none' },
                { k: 'Other open items', v: d.author.otherOpenItems },
              ]}
            />
          </Card>
        )}
      </Section>

      {d.suggestion ? (
        <Card variant="raised" className="p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="type-label-sm text-ink">Suggested: {STAFF_ACTIONS.find((a) => a.id === d.suggestion!.action)?.label ?? d.suggestion.action}</div>
              <p className="type-footnote text-ink-2">{d.suggestion.reason}</p>
            </div>
            {open ? (
              <Button size="sm" variant="secondary" onClick={() => onAction(d.suggestion!.action)}>
                Use
              </Button>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Section title="History" hint={`${d.history.length}`}>
        {d.history.length === 0 ? <p className="type-footnote text-ink-3">No actions yet.</p> : null}
        {d.history.map((h, i) => (
          <div key={i} className="flex flex-col gap-1 rounded-md bg-surface-1 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="soft" tone={h.action.startsWith('remove') || h.action === 'ban' || h.action.startsWith('suspend') ? 'danger' : 'neutral'}>{h.action}</Badge>
              <Badge variant="outline" tone={ROLE_TONE[h.actorRole]}>{h.actorName ?? h.actorRole}</Badge>
              <span className="ml-auto type-caption text-ink-3"><TimeAgo ts={h.createdAt} /></span>
            </div>
            {h.note ? <p className="type-footnote text-ink-2">{h.note}</p> : null}
          </div>
        ))}
      </Section>

      <div className="flex flex-col gap-2">
        {d.claimedByOther ? (
          <p className="type-footnote text-ink-3">Being reviewed by another staff member. Actions unlock when their 10-minute claim ends.</p>
        ) : (
          <div className="flex gap-2">
            <Button variant={open ? 'primary' : 'secondary'} leftIcon={Gavel} fullWidth onClick={() => onAction(null)}>
              {open ? 'Take action' : 'Restore / lift'}
            </Button>
            {d.canUnmask ? (
              <Button variant="danger-ghost" leftIcon={Eye} onClick={onUnmask}>
                Unmask
              </Button>
            ) : null}
          </div>
        )}
        {open && d.claimedByMe ? (
          <Button variant="ghost" size="sm" leftIcon={Lock} loading={claim.isPending} onClick={() => claim.mutate('release')}>
            Release my claim
          </Button>
        ) : null}
        {open && !d.claimedByMe && !d.claimedByOther ? (
          <Button variant="ghost" size="sm" leftIcon={Lock} loading={claim.isPending} onClick={() => claim.mutate('claim')}>
            Claim for 10 minutes
          </Button>
        ) : null}
      </div>
      <div className="type-caption text-ink-3">
        <HighlightedText text="Approve · Dismiss close the item · Remove strikes the author · Warn / mute act on the author blind · Suspend, ban, external escalation and lifts are admin only." />
      </div>
    </div>
  );
};

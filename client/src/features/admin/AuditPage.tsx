/**
 * Audit log (safety §6.6): moderators see their own rows, admins everything. Monospace timestamps, actor, action
 * badge (unmask rows highlighted), target, expandable reason. Filters: action · target type · (admins) actor id.
 */
import { useMemo, useState, type FC } from 'react';
import { ScrollText } from 'lucide-react';
import type { AuditRow } from '@shared/admin';
import { Badge, Button, Card, EmptyState, ErrorState, InfiniteSentinel, Input, Select, type SelectOption } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useAudit, type AuditFilters } from './api';
import { ROLE_TONE, RowSkeleton } from './parts';
import { AdminShell } from './shell';

const ACTION_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'all', label: 'Any action' },
  ...['approve', 'remove', 'remove_and_warn', 'remove_and_mute_24h', 'remove_and_mute_72h', 'remove_and_mute_7d', 'warn_only', 'dismiss_reports', 'lock_thread', 'escalate',
    'escalate_external', 'suspend_7d', 'suspend_30d', 'ban', 'lift_sanction', 'restore', 'buzz_unmask', 'buzz_unmask_subject', 'sanction_apply', 'sanction_lift', 'strike_add',
    'strike_revoke', 'appeal_create', 'appeal_decide', 'sanction_reduce', 'role_grant', 'role_revoke', 'org_verify', 'org_unverify', 'rule_pack_toggle', 'reporter_viewed',
    'dm_context_viewed', 'role_bootstrap'].map((a) => ({ value: a, label: a })),
];
const TARGET_OPTIONS: readonly SelectOption<string>[] = [
  { value: 'all', label: 'Any target' },
  ...['buzz', 'buzz_reply', 'orbit_post', 'orbit_comment', 'reel', 'reel_comment', 'message', 'conversation', 'market_listing', 'roommate_listing', 'event', 'profile', 'user', 'appeal', 'rule_pack', 'queue'].map((t) => ({ value: t, label: t })),
];

const UNMASK = new Set(['buzz_unmask', 'buzz_unmask_subject']);

const AuditRowView: FC<{ row: AuditRow }> = ({ row }) => {
  const [open, setOpen] = useState(false);
  const unmask = UNMASK.has(row.action);
  const meta = row.metadata && Object.keys(row.metadata).length ? JSON.stringify(row.metadata) : null;
  return (
    <Card className={unmask ? 'border-warning bg-warning-soft p-3' : 'p-3'}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono type-micro text-ink-3">{new Date(row.createdAt).toISOString().replace('T', ' ').slice(0, 19)}</span>
        <Badge variant="soft" tone={unmask ? 'warning' : row.action.startsWith('remove') || row.action === 'ban' || row.action.startsWith('suspend') ? 'danger' : 'neutral'}>{row.action}</Badge>
        {row.actor ? <Badge variant="outline" tone={ROLE_TONE[row.actor.role]}>{row.actor.displayName}</Badge> : <Badge variant="outline">system</Badge>}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 type-caption text-ink-3">
        {row.targetType ? (
          <span>
            {row.targetType}
            {row.targetId ? <span className="font-mono"> · {row.targetId}</span> : null}
          </span>
        ) : null}
        {row.queueId ? (
          <Button size="sm" variant="ghost" to={routes.adminQueueItem(row.queueId)}>
            queue item
          </Button>
        ) : null}
        {row.batchId ? <span className="font-mono">batch {row.batchId.slice(0, 6)}</span> : null}
        {row.reasonCode ? <Badge variant="outline" tone="warning">{row.reasonCode}</Badge> : null}
      </div>
      {row.reason || meta ? (
        <button type="button" className="mt-1 type-caption text-accent-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide details' : 'Details'}
        </button>
      ) : null}
      {open ? (
        <div className="mt-1 flex flex-col gap-1">
          {row.reason ? <p className="type-footnote text-ink-2">{row.reason}</p> : null}
          {meta ? <pre className="overflow-x-auto rounded-sm bg-surface-2 p-2 font-mono type-micro text-ink-2">{meta}</pre> : null}
        </div>
      ) : null}
    </Card>
  );
};

export const AuditPage: FC = () => {
  const me = useMe();
  const [action, setAction] = useState('all');
  const [targetType, setTargetType] = useState('all');
  const [actor, setActor] = useState('');
  const actorDebounced = useDebounced(actor, 300);
  useScreenView('admin_audit');
  const filters: AuditFilters = useMemo(
    () => ({
      ...(action !== 'all' ? { action } : {}),
      ...(targetType !== 'all' ? { targetType } : {}),
      ...(me.role === 'admin' && actorDebounced.trim() ? { actor: actorDebounced.trim() } : {}),
    }),
    [action, targetType, actorDebounced, me.role],
  );
  const list = useAudit(filters);

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {Array.from({ length: 5 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState title="Couldn't load the audit log" error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = <EmptyState icon={ScrollText} title="No actions logged yet." compact />;
  } else {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {list.items.map((row) => (
          <AuditRowView key={row.id} row={row} />
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel="End of the log" />
      </div>
    );
  }

  return (
    <AdminShell tab="audit">
      <div className="flex flex-col gap-2 px-4">
        <div className="grid grid-cols-2 gap-2">
          <Select<string> label="Action" value={action} onChange={setAction} options={ACTION_OPTIONS} />
          <Select<string> label="Target" value={targetType} onChange={setTargetType} options={TARGET_OPTIONS} />
        </div>
        {me.role === 'admin' ? <Input label="Actor id" placeholder="u_… (admins only)" value={actor} onChange={(e) => setActor(e.target.value)} onClear={() => setActor('')} /> : <p className="type-caption text-ink-3">Moderators see their own actions. Append-only: nothing here can be edited or deleted.</p>}
      </div>
      {body}
    </AdminShell>
  );
};

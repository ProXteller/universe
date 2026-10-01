/**
 * Users: lookup by handle / name (admins: email) and the account standing page — role, status, strike points, open
 * items, sanctions (moderators never see anon-origin rows: foundation `staffStandingFor`), direct public-origin
 * sanctions, lifts (admin), role grants and org verification (admin).
 */
import { useState, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, UserX } from 'lucide-react';
import type { ModerationCategory, Role, SanctionScope } from '@shared/core';
import { CATEGORY_LABELS } from '@shared/core';
import type { StaffSanctionRow, StaffUserDetail } from '@shared/admin';
import { DIRECT_SANCTION_PRESETS, SANCTION_KIND_LABELS } from '@shared/admin';
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, InfiniteSentinel, Input, ListRow, Select, Sheet, Skeleton, SkeletonText, Switch, Textarea, type SelectOption } from '@/ui';
import { ComposerModeBanner, TimeAgo, UserRow } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { formatDayTime } from '@/lib/format';
import { useDebounced } from '@/lib/hooks';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useDirectSanction, useLiftSanction, useSetRole, useSetVerified, useStaffUser, useUserSearch } from './api';
import { KeyValue, ROLE_TONE, RowSkeleton, Section } from './parts';
import { AdminShell } from './shell';

const CATEGORY_OPTIONS: readonly SelectOption<ModerationCategory>[] = (Object.keys(CATEGORY_LABELS) as ModerationCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] }));
const SCOPE_OPTIONS: readonly SelectOption<SanctionScope>[] = [
  { value: 'all', label: 'Everything', description: 'No posting anywhere' },
  { value: 'buzz_only', label: 'Buzz only' },
  { value: 'requests', label: 'Message requests only' },
];
const ROLE_OPTIONS: readonly SelectOption<Role>[] = [
  { value: 'user', label: 'User' },
  { value: 'moderator', label: 'Moderator', description: 'Queues, actions, warnings and mutes; blind on Buzz' },
  { value: 'admin', label: 'Admin', description: 'Everything, including suspensions, bans and unmask' },
];

const StatusBadges: FC<{ u: StaffUserDetail }> = ({ u }) => (
  <div className="flex flex-wrap gap-1.5">
    <Badge variant="soft" tone={ROLE_TONE[u.role]}>{u.role}</Badge>
    <Badge variant="outline" tone={u.status === 'active' ? 'success' : 'danger'}>{u.status}</Badge>
    <Badge variant="outline" tone={u.strikePoints ? 'warning' : 'neutral'}>{u.strikePoints} strike pts</Badge>
    {u.openQueueItems ? <Badge variant="outline" tone="info">{u.openQueueItems} open</Badge> : null}
  </div>
);

/* ------------------------------------------------------------------ lookup */

export const UsersPage: FC = () => {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q, 250);
  const list = useUserSearch(debounced);
  useScreenView('admin_users');

  let body;
  if (debounced.trim().length < 2) {
    body = <EmptyState icon={Search} title="Search by handle or name." description="Two characters or more." compact />;
  } else if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {Array.from({ length: 4 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState title="Couldn't search accounts" error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = <EmptyState icon={UserX} title="No accounts match." compact />;
  } else {
    body = (
      <div className="flex flex-col gap-2 px-4">
        {list.items.map((u) => (
          <Card key={u.user.id} className="p-2" onClick={() => navigate(routes.adminUser(u.user.id))} aria-label={`Open ${u.user.displayName}`}>
            <UserRow user={u.user} trailing="none" onClick={() => navigate(routes.adminUser(u.user.id))} />
            <div className="px-2 pb-1">
              <StatusBadges u={u} />
            </div>
          </Card>
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
      </div>
    );
  }

  return (
    <AdminShell tab="users">
      <div className="px-4">
        <Input variant="search" placeholder="Handle, name or email" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} aria-label="Search accounts" autoFocus />
      </div>
      {body}
    </AdminShell>
  );
};

/* ------------------------------------------------------------------ detail */

const SanctionRowView: FC<{ s: StaffSanctionRow; canLift: boolean; onLift(): void }> = ({ s, canLift, onLift }) => {
  const active = (s.until === null || s.until > Date.now()) && s.kind !== 'warning' && s.kind !== 'removal';
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="soft" tone={s.kind === 'ban' || s.kind === 'suspension' ? 'danger' : s.kind === 'mute' ? 'warning' : 'neutral'}>{SANCTION_KIND_LABELS[s.kind]}</Badge>
        <Badge variant="outline" tone={s.origin === 'anon' ? 'info' : 'neutral'}>{s.origin === 'anon' ? 'Buzz origin' : 'Public origin'}</Badge>
        {s.category ? <span className="type-caption text-ink-2">{CATEGORY_LABELS[s.category]}</span> : null}
        <span className="ml-auto type-caption text-ink-3"><TimeAgo ts={s.createdAt} /></span>
      </div>
      <div className="mt-2 type-caption text-ink-3">
        {s.scope !== 'all' ? `Scope ${s.scope} · ` : ''}
        {s.until ? `until ${formatDayTime(s.until)}` : s.kind === 'ban' ? 'permanent' : 'no end time'}
        {s.appealStatus !== 'none' ? ` · appeal ${s.appealStatus}` : ''}
        {s.acknowledgedAt ? ' · acknowledged' : ''}
      </div>
      {canLift && active ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" onClick={onLift}>
            Lift
          </Button>
        </div>
      ) : null}
    </Card>
  );
};

export const UserDetailPage: FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const me = useMe();
  const navigate = useNavigate();
  const user = useStaffUser(id || undefined);
  const setRole = useSetRole(id);
  const setVerified = useSetVerified(id);
  const sanction = useDirectSanction(id);
  const lift = useLiftSanction(id);
  useScreenView('admin_user');

  const [sheet, setSheet] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [category, setCategory] = useState<ModerationCategory | null>(null);
  const [scope, setScope] = useState<SanctionScope>('all');
  const [note, setNote] = useState('');
  const [liftId, setLiftId] = useState<string | null>(null);
  const [liftNote, setLiftNote] = useState('');
  const [roleDraft, setRoleDraft] = useState<Role | null>(null);

  const admin = me.role === 'admin';
  const presets = DIRECT_SANCTION_PRESETS.filter((p) => admin || !p.adminOnly);
  const chosen = presets.find((p) => p.id === preset) ?? null;
  const valid = chosen !== null && category !== null && note.trim().length >= 10;
  const apply = (): void => {
    if (!chosen || !category) return;
    sanction.mutate(
      { kind: chosen.kind, durationMs: chosen.durationMs ?? undefined, scope: chosen.kind === 'mute' ? scope : undefined, category, note: note.trim() },
      {
        onSuccess: () => {
          toast.success(`${chosen.label} applied · logged`);
          setSheet(false);
          setNote('');
        },
      },
    );
  };

  let body;
  const u = user.data;
  if (user.isLoading) {
    body = (
      <div className="flex flex-col gap-3 px-4">
        <div className="flex items-center gap-3">
          <Skeleton circle w={48} h={48} />
          <SkeletonText lines={2} />
        </div>
        <SkeletonText lines={3} />
      </div>
    );
  } else if (user.isError || !u) {
    body = <ErrorState title="Couldn't load this account" error={user.error} onRetry={() => void user.refetch()} />;
  } else {
    body = (
      <div className="flex flex-col gap-4 px-4">
        <Card className="p-2">
          <UserRow user={u.user} size="lg" trailing="none" onClick={() => navigate(routes.profile(u.user.handle))} />
          <div className="px-2 pb-2">
            <StatusBadges u={u} />
          </div>
        </Card>
        <KeyValue
          rows={[
            { k: 'Campus', v: u.user.university.name },
            { k: 'Joined', v: formatDayTime(u.user.createdAt) },
            ...(u.email ? [{ k: 'Email', v: u.email }] : []),
            { k: 'Followers', v: `${u.user.followerCount} · following ${u.user.followingCount}` },
            { k: 'Public posts', v: `${u.user.postCount} posts · ${u.user.reelCount} reels` },
          ]}
        />
        {!admin ? <p className="type-caption text-ink-3">Moderator view: public-origin standing only.</p> : null}

        <Section title="Sanctions" hint={`${u.sanctions.length}`}>
          {u.sanctions.length === 0 ? <p className="type-footnote text-ink-3">No sanctions on this account.</p> : null}
          {u.sanctions.map((s) => (
            <SanctionRowView key={s.id} s={s} canLift={admin} onLift={() => { setLiftId(s.id); setLiftNote(''); }} />
          ))}
        </Section>

        <Section title="Actions">
          <Button variant="danger" fullWidth disabled={u.user.id === me.id} onClick={() => { setPreset(presets[0]?.id ?? null); setCategory(null); setNote(''); setSheet(true); }}>
            Apply sanction
          </Button>
          {admin ? (
            <>
              <Select<Role> label="Role" value={u.role} onChange={(r) => setRoleDraft(r)} options={ROLE_OPTIONS} disabled={u.user.id === me.id} />
              {u.user.accountType === 'org' ? (
                <ListRow
                  title="Verified org"
                  subtitle="Gold tick on every public surface"
                  trailing={<Switch checked={u.user.isVerified} onChange={(v) => setVerified.mutate({ verified: v }, { onSuccess: () => toast.success(v ? 'Verified' : 'Verification removed') })} aria-label="Verified org" />}
                />
              ) : null}
            </>
          ) : null}
        </Section>
      </div>
    );
  }

  return (
    <AdminShell tab="users" title="Account" detail>
      {body}

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Apply sanction"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth disabled={!valid} loading={sanction.isPending} onClick={apply}>
              {chosen?.label ?? 'Apply'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ComposerModeBanner mode="public" verb="Acting" size="inline" note="Direct sanctions are public-origin and audited." />
          <Select<string> label="Sanction" value={preset} onChange={setPreset} options={presets.map((p) => ({ value: p.id, label: p.label }))} sheetTitle="Sanctions ladder" />
          {chosen?.kind === 'mute' ? <Select<SanctionScope> label="Scope" value={scope} onChange={setScope} options={SCOPE_OPTIONS} /> : null}
          <Select<ModerationCategory> label="Guideline" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} placeholder="Pick the guideline" />
          <Textarea label="Note (required, ≥ 10 characters, staff only)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} minRows={2} />
        </div>
      </Sheet>

      <Dialog
        open={liftId !== null}
        onOpenChange={(o) => { if (!o) setLiftId(null); }}
        title="Lift this sanction?"
        description="The account returns to active immediately. A lifted suspension is treated as new for 72 hours."
        confirmLabel="Lift and log"
        confirmDisabled={liftNote.trim().length < 10}
        onConfirm={async () => {
          if (!liftId) return;
          await lift.mutateAsync({ sanctionId: liftId, note: liftNote.trim() });
          toast.success('Sanction lifted');
          setLiftId(null);
        }}
      >
        <div className="flex flex-col gap-3">
          <ComposerModeBanner mode="public" verb="Acting" size="inline" />
          <Textarea label="Note (≥ 10 characters)" value={liftNote} onChange={(e) => setLiftNote(e.target.value)} maxLength={1000} minRows={2} />
        </div>
      </Dialog>

      <Dialog
        open={roleDraft !== null}
        onOpenChange={(o) => { if (!o) setRoleDraft(null); }}
        title={`Change role to ${roleDraft ?? ''}?`}
        description="Role grants and revocations are written to the audit log."
        confirmLabel="Change role"
        onConfirm={async () => {
          if (!roleDraft) return;
          await setRole.mutateAsync({ role: roleDraft });
          toast.success(`Role set to ${roleDraft}`);
          setRoleDraft(null);
        }}
      />
    </AdminShell>
  );
};

/**
 * Account status (`/settings/account-status`, SPEC §4.4.2 / §5.10): the ONLY screen a suspended or banned user can
 * reach besides the SanctionGate. Renders with `useMeOptional()`, no nav, and calls only endpoints #7 (sign out),
 * #9 (`/me` via the session), #17 (`GET /me/sanctions`), #18 (acknowledge) and #19 (`POST /appeals`).
 * This slice owns the appeal form (a create surface → `ComposerModeBanner`).
 */
import { useEffect, useState, type FC } from 'react';
import { BookOpen, LogOut, MicOff, Scale, ShieldAlert, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SanctionNotice } from '@shared/core';
import { CATEGORY_LABELS, LIMITS } from '@shared/core';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Screen, Skeleton, Textarea } from '@/ui';
import { ComposerModeBanner } from '@/components';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatDate, formatDayTime } from '@/lib/format';
import { routes } from '@/lib/links';
import { handleModerationError } from '@/lib/moderation';
import { logout, useMeOptional } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useAcknowledgeSanction, useAppeal, useSanctions } from '../api';

const KIND: Record<SanctionNotice['kind'], { label: string; icon: LucideIcon; tone: 'warning' | 'danger' | 'neutral' }> = {
  warning: { label: 'Warning', icon: ShieldAlert, tone: 'warning' },
  mute: { label: 'Mute', icon: MicOff, tone: 'warning' },
  suspension: { label: 'Suspension', icon: ShieldX, tone: 'danger' },
  ban: { label: 'Ban', icon: ShieldX, tone: 'danger' },
  removal: { label: 'Content removed', icon: Trash2, tone: 'neutral' },
};

const APPEAL: Record<SanctionNotice['appealStatus'], string | null> = {
  none: null,
  open: 'Appeal under review',
  upheld: 'Appeal reviewed: decision stands',
  reversed: 'Appeal accepted',
  reduced: 'Appeal reviewed: reduced',
};

const AppealForm: FC<{ notice: SanctionNotice; onDone(): void }> = ({ notice, onDone }) => {
  const [text, setText] = useState('');
  const appeal = useAppeal();
  const submit = () =>
    appeal.mutate(
      { sanctionId: notice.id, text: text.trim() },
      {
        onSuccess: () => {
          toast.success("Appeal sent. A different reviewer will look at it.");
          onDone();
        },
        onError: (e) => {
          if (!handleModerationError(e)) toast.error(errorMessage(e));
        },
      },
    );
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-3">
      <ComposerModeBanner mode="public" verb="Appealing" note="Read by the Trust & Safety team only." />
      <Textarea
        label="Why should this be reviewed?"
        placeholder="Tell us what we got wrong. Be specific."
        value={text}
        onChange={(e) => setText(e.target.value)}
        minRows={3}
        maxLength={LIMITS.appealText}
        showCount
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={appeal.isPending}>
          Cancel
        </Button>
        <Button leftIcon={Scale} loading={appeal.isPending} disabled={text.trim().length < 10} onClick={submit}>
          Send appeal
        </Button>
      </div>
    </div>
  );
};

const NoticeCard: FC<{ notice: SanctionNotice }> = ({ notice }) => {
  const [appealing, setAppealing] = useState(false);
  const ack = useAcknowledgeSanction();
  const kind = KIND[notice.kind];
  const Icon = kind.icon;
  const category = notice.category ? CATEGORY_LABELS[notice.category] : null;
  const appealLabel = APPEAL[notice.appealStatus];
  const active = notice.until === null || notice.until > Date.now();

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${kind.tone === 'danger' ? 'bg-danger-soft text-danger' : kind.tone === 'warning' ? 'bg-warning-soft text-warning' : 'bg-surface-3 text-ink-2'}`} aria-hidden>
          <Icon size={20} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="type-headline text-ink">{kind.label}</p>
            {notice.scope !== 'all' ? (
              <Badge variant="outline" tone="neutral">
                {notice.scope === 'buzz_only' ? 'Buzz only' : 'Requests only'}
              </Badge>
            ) : null}
            {appealLabel ? (
              <Badge variant="soft" tone={notice.appealStatus === 'reversed' ? 'success' : notice.appealStatus === 'open' ? 'info' : 'neutral'}>
                {appealLabel}
              </Badge>
            ) : null}
          </div>
          <p className="type-footnote text-ink-2">
            {category ? `Guideline: ${category}` : 'Community guidelines'}
            {notice.contentLabel ? ` · your ${notice.contentLabel}` : ''}
          </p>
          <p className="type-caption tabular-nums text-ink-3">
            {formatDate(notice.startsAt)}
            {notice.until ? ` – ${formatDayTime(notice.until)}` : notice.kind === 'ban' ? ' – permanent' : ''}
            {!active ? ' · ended' : ''}
          </p>
        </div>
      </div>

      {notice.contentExcerpt ? (
        <blockquote className="rounded-md border border-line bg-surface-2 px-3 py-2 type-footnote text-ink-2">“{notice.contentExcerpt}”</blockquote>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {notice.guidelineAnchor ? (
          <Button variant="ghost" size="sm" leftIcon={BookOpen} to={routes.guidelines(notice.guidelineAnchor)}>
            Read the guideline
          </Button>
        ) : null}
        {notice.acknowledgedAt === null ? (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={ShieldCheck}
            loading={ack.isPending}
            onClick={() => ack.mutate(notice.id, { onError: (e) => toast.error(errorMessage(e)) })}
          >
            Got it
          </Button>
        ) : null}
        {notice.canAppeal && notice.appealStatus === 'none' && !appealing ? (
          <Button size="sm" leftIcon={Scale} onClick={() => setAppealing(true)}>
            Appeal
          </Button>
        ) : null}
        {notice.canAppeal && notice.appealStatus === 'none' && notice.appealDeadline ? (
          <span className="type-caption text-ink-3">Appeal by {formatDate(notice.appealDeadline)}</span>
        ) : null}
      </div>

      {appealing ? <AppealForm notice={notice} onDone={() => setAppealing(false)} /> : null}
    </Card>
  );
};

export const AccountStatusPage: FC = () => {
  const me = useMeOptional();
  const sanctions = useSanctions();
  const [leaving, setLeaving] = useState(false);
  const restricted = me?.status === 'suspended' || me?.status === 'banned';

  // A restricted session may reach only #7 / #9 / #17–#19 (SPEC §4.4.2): no analytics beacon from this screen then.
  useEffect(() => {
    if (!restricted) track('screen_view', { screen: 'settings_account_status' });
  }, [restricted]);
  const active = me?.activeSanction ?? null;
  const standing = restricted
    ? me?.status === 'banned'
      ? 'Your account is permanently banned.'
      : `Your account is suspended${active?.until ? ` until ${formatDate(active.until)}` : ''}.`
    : active
      ? `You're muted${active.until ? ` until ${formatDate(active.until)}` : ''}${active.scope === 'buzz_only' ? ' on Buzz' : active.scope === 'requests' ? ' for new requests' : ''}.`
      : 'Your account is in good standing.';

  return (
    <Screen header={<PageHeader title="Account status" mode="compact" back={!restricted} />} className="gap-4 px-4 pb-4 pt-2">
      <Card variant={active || restricted ? 'flat' : 'hero'} className="flex items-center gap-3">
        <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${active || restricted ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent-ink'}`} aria-hidden>
          {active || restricted ? <ShieldAlert size={20} strokeWidth={1.75} /> : <ShieldCheck size={20} strokeWidth={1.75} />}
        </span>
        <div className="min-w-0">
          <p className="type-headline text-ink">{standing}</p>
          <p className="type-footnote text-ink-2">Notices about your own content and account appear below.</p>
        </div>
      </Card>

      {sanctions.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
          {Array.from({ length: 2 }, (_, i) => (
            <Card key={i} className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Skeleton w={40} h={40} circle />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton w="35%" h={14} />
                  <Skeleton w="60%" h={10} />
                </div>
              </div>
              <Skeleton w="100%" h={40} className="rounded-md" />
            </Card>
          ))}
        </div>
      ) : sanctions.isError ? (
        <ErrorState error={sanctions.error} onRetry={() => void sanctions.refetch()} />
      ) : sanctions.data && sanctions.data.items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Nothing on your record." description="Warnings, removals and restrictions would show up here." compact />
      ) : (
        <div className="flex flex-col gap-3">
          {sanctions.data?.items.map((n) => (
            <NoticeCard key={n.id} notice={n} />
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <Button variant="secondary" fullWidth leftIcon={BookOpen} to={routes.guidelines()}>
          Community Guidelines
        </Button>
        <Button
          variant="ghost"
          fullWidth
          leftIcon={LogOut}
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void logout().finally(() => setLeaving(false));
          }}
        >
          Sign out
        </Button>
      </div>
    </Screen>
  );
};

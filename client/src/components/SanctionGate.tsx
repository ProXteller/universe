/**
 * SanctionGate (SPEC §4.4.2, safety §4.4). Mounted once by AppShell.
 *  - Session `'restricted'` (suspended / banned): covers every route except `/settings/account-status`,
 *    `/guidelines`, `/legal/*` with the suspension / ban screen — [Appeal] → account status, [Read the guidelines],
 *    [Log out]. Apartments owns the appeal form on `/settings/account-status`.
 *  - Session `'ready'`: the warning-acknowledge modal for unacknowledged warnings from `GET /me/sanctions`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BookOpen, LogOut, Scale, ShieldAlert, ShieldX } from 'lucide-react';
import { CATEGORY_LABELS, type Paginated, type SanctionNotice } from '@shared/core';
import { Button, Dialog } from '@/ui';
import { api } from '@/lib/api';
import { formatDate, formatDayTime } from '@/lib/format';
import { routes } from '@/lib/links';
import { logout, useMeOptional, useSessionStatus } from '@/lib/session';
import { queryClient } from '@/lib/query';
import { useSessionStore } from '@/stores/session';

const EXEMPT = (pathname: string) =>
  pathname === routes.accountStatus() || pathname === '/guidelines' || pathname.startsWith('/legal/');

function categoryLabel(category: SanctionNotice['category']): string {
  return category ? CATEGORY_LABELS[category] : 'our guidelines';
}

function RestrictedScreen() {
  const me = useMeOptional();
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const sanction = me?.activeSanction ?? null;
  const banned = me?.status === 'banned' || sanction?.kind === 'ban';
  const category = sanction?.category ? CATEGORY_LABELS[sanction.category] : null;
  const until = sanction?.until ?? null;

  const title = banned
    ? 'Your account has been permanently banned'
    : until
      ? `Your account is suspended until ${formatDate(until)}`
      : 'Your account is suspended';
  const body = banned
    ? `${category ? `Reason: ${category}. ` : ''}You can appeal once within 14 days.`
    : `${category ? `Reason: ${category}. ` : ''}You can appeal once.`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sanction-title"
      className="absolute inset-0 z-(--z-dialog) flex flex-col bg-canvas text-ink"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex size-18 items-center justify-center rounded-full bg-danger-soft text-danger">
          {banned ? <ShieldX size={32} strokeWidth={1.75} aria-hidden /> : <ShieldAlert size={32} strokeWidth={1.75} aria-hidden />}
        </span>
        <h1 id="sanction-title" className="type-title-1">
          {title}
        </h1>
        <p className="max-w-[32ch] type-body text-ink-2">{body}</p>
        {until && !banned ? <p className="type-footnote text-ink-3">Lifts {formatDayTime(until)}</p> : null}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        <Button size="lg" fullWidth leftIcon={Scale} onClick={() => navigate(routes.accountStatus())}>
          Appeal
        </Button>
        <Button variant="secondary" size="lg" fullWidth leftIcon={BookOpen} onClick={() => navigate(routes.guidelines())}>
          Read the guidelines
        </Button>
        <Button
          variant="ghost"
          size="lg"
          fullWidth
          leftIcon={LogOut}
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void logout().finally(() => setLeaving(false));
          }}
        >
          Log out
        </Button>
      </div>
    </div>
  );
}

function WarningAck() {
  const navigate = useNavigate();
  const epoch = useSessionStore((s) => s.sessionEpoch);
  const q = useQuery<Paginated<SanctionNotice>>({
    queryKey: ['me', 'sanctions', epoch],
    queryFn: () => api.get<Paginated<SanctionNotice>>('/me/sanctions'),
    staleTime: 5 * 60_000,
  });
  const pending = useMemo(
    () => (q.data?.items ?? []).filter((s) => s.kind === 'warning' && s.acknowledgedAt === null).sort((a, b) => a.createdAt - b.createdAt)[0] ?? null,
    [q.data],
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ack = useMutation<void, unknown, string>({
    mutationFn: (id) => api.post<void>(`/me/sanctions/${encodeURIComponent(id)}/ack`),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Paginated<SanctionNotice>>(['me', 'sanctions', epoch], (d) =>
        d ? { ...d, items: d.items.map((s) => (s.id === id ? { ...s, acknowledgedAt: Date.now() } : s)) } : d,
      );
      void queryClient.invalidateQueries({ queryKey: ['me', 'sanctions'] });
    },
  });

  // Another tab / ws event may invalidate ['me','sanctions'] (the epoch-suffixed key matches by prefix).
  useEffect(() => {
    setDismissed(null);
  }, [epoch]);

  if (!pending || dismissed === pending.id) return null;
  const what = pending.contentLabel ?? 'post';
  return (
    <Dialog
      open
      // The cancel button is "Read the guideline": leave the modal for the guidelines page (the warning stays
      // unacknowledged and comes back on the next app open — never nagging within a session).
      onOpenChange={(o) => {
        if (o) return;
        setDismissed(pending.id);
        navigate(routes.guidelines(pending.guidelineAnchor ?? undefined));
      }}
      persistent
      icon={ShieldAlert}
      title="Heads up."
      description={`Your ${what} broke our guideline on ${categoryLabel(pending.category)}. No restrictions this time. Further violations can limit your account.`}
      confirmLabel="Got it"
      cancelLabel="Read the guideline"
      onConfirm={async () => {
        setDismissed(pending.id);
        await ack.mutateAsync(pending.id).catch(() => undefined);
      }}
    >
      {pending.contentExcerpt ? (
        <blockquote className="rounded-md border border-line bg-surface-2 px-3 py-2 text-left type-footnote text-ink-2">
          “{pending.contentExcerpt}”
        </blockquote>
      ) : null}
    </Dialog>
  );
}

export function SanctionGate() {
  const status = useSessionStatus();
  const { pathname } = useLocation();
  if (status === 'restricted') {
    return EXEMPT(pathname) ? null : <RestrictedScreen />;
  }
  if (status === 'ready') return <WarningAck />;
  return null;
}

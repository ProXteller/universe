/**
 * Rules: the rule packs on/off (admins; each toggle is audited) and the Limitations panel (everyone; safety §8.3 G1–G5 + A1).
 */
import type { FC } from 'react';
import { ListChecks } from 'lucide-react';
import { LIMITATIONS } from '@shared/admin';
import { Badge, Card, EmptyState, ErrorState, ListRow, Switch } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useLimitations, useRulePacks, useTogglePack } from './api';
import { LimitationsPanel, RowSkeleton, Section } from './parts';
import { AdminShell } from './shell';

export const RulesPage: FC = () => {
  const me = useMe();
  const admin = me.role === 'admin';
  const packs = useRulePacks(admin);
  const toggle = useTogglePack();
  const limitations = useLimitations();
  useScreenView('admin_rules');

  let packsBody = null;
  if (admin) {
    if (packs.isLoading) {
      packsBody = (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <RowSkeleton key={i} lines={1} />
          ))}
        </div>
      );
    } else if (packs.isError || !packs.data) {
      packsBody = <ErrorState title="Couldn't load rule packs" error={packs.error} onRetry={() => void packs.refetch()} inline />;
    } else if (packs.data.length === 0) {
      packsBody = <EmptyState icon={ListChecks} title="No rule packs registered." compact />;
    } else {
      packsBody = (
        <Card className="divide-y divide-line-subtle p-0">
          {packs.data.map((p) => (
            <ListRow
              key={p.id}
              title={<span className="font-mono">{p.id}</span>}
              subtitle={`v${p.version} · ${p.ruleCount} rules`}
              meta={p.id === 'baseline' ? <Badge variant="outline">foundation</Badge> : undefined}
              trailing={
                <Switch
                  checked={p.enabled}
                  disabled={p.id === 'baseline' || toggle.isPending}
                  onChange={(enabled) => toggle.mutate({ id: p.id, enabled }, { onSuccess: () => toast.success(`${p.id} ${enabled ? 'enabled' : 'disabled'} · logged`) })}
                  aria-label={`${p.id} enabled`}
                />
              }
            />
          ))}
        </Card>
      );
    }
  }

  return (
    <AdminShell tab="rules">
      <div className="flex flex-col gap-5 px-4">
        {admin ? (
          <Section title="Rule packs" hint="toggles are audited">
            {packsBody}
            <p className="type-caption text-ink-3">The baseline pack stays on. Every text write is evaluated against every enabled pack; the strictest outcome wins.</p>
          </Section>
        ) : (
          <p className="type-footnote text-ink-3">Rule packs are managed by admins. The limitations below apply to every review.</p>
        )}
        <LimitationsPanel items={limitations.data ?? LIMITATIONS} />
      </div>
    </AdminShell>
  );
};

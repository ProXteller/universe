/** The Trust & Safety shell: compact header with the role badge and the tabs Queue · Users · Appeals · Audit · Analytics · Rules (SPEC §2.3, design §7.10). */
import type { FC, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, PageHeader, Screen, Tabs } from '@/ui';
import { routes } from '@/lib/links';
import { useMe } from '@/lib/session';
import { useQueueCounts } from './api';
import { ROLE_TONE } from './parts';

export type AdminTab = 'queue' | 'users' | 'appeals' | 'audit' | 'analytics' | 'rules';

const TABS: readonly { value: AdminTab; label: string }[] = [
  { value: 'queue', label: 'Queue' },
  { value: 'users', label: 'Users' },
  { value: 'appeals', label: 'Appeals' },
  { value: 'audit', label: 'Audit' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'rules', label: 'Rules' },
];

export interface AdminShellProps {
  tab: AdminTab;
  title?: string;
  /** Pushed detail screens: compact header with back, no tabs. */
  detail?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

export const AdminShell: FC<AdminShellProps> = ({ tab, title, detail, footer, children }) => {
  const me = useMe();
  const navigate = useNavigate();
  const counts = useQueueCounts();
  const tabs = TABS.map((t) => ({
    ...t,
    count: t.value === 'queue' ? counts.data?.priority : t.value === 'appeals' ? counts.data?.appeals : undefined,
  }));
  const header = (
    <PageHeader
      title={title ?? 'Trust & Safety'}
      subtitle={
        <span className="inline-flex items-center gap-2">
          <Badge variant="soft" tone={ROLE_TONE[me.role]}>{me.role}</Badge>
          <span className="type-caption text-ink-3">@{me.handle}</span>
        </span>
      }
      back
      below={
        detail ? undefined : (
          <div className="bg-canvas">
            <Tabs<AdminTab> value={tab} onChange={(v) => navigate(v === 'queue' ? routes.admin() : routes.admin(v))} tabs={tabs} scrollable aria-label="Trust & Safety sections" />
          </div>
        )
      }
    />
  );
  return (
    <Screen header={header} footer={footer} className="gap-4 pt-2 pb-6">
      {children}
    </Screen>
  );
};

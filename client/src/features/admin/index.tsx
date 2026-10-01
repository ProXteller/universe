/**
 * `admin` slice entry (SPEC §4.6, R5): `AdminRoutes`, `GuidelinesPage`, `GuidelinesContent` — names and prop types
 * frozen. Routes (SPEC §4.5): `/admin`, `/admin/queue/:id`, `/admin/users`, `/admin/users/:id`, `/admin/appeals`,
 * `/admin/audit`, `/admin/analytics`, `/admin/rules` (the foundation router already renders NotFound for non-staff).
 * No import-time side effects (R4).
 */
import type { FC } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { GuidelinesContentProps } from '@/app/contracts';
import { routes } from '@/lib/links';
import { AnalyticsPage } from './AnalyticsPage';
import { AppealsPage } from './AppealsPage';
import { AuditPage } from './AuditPage';
import { GuidelinesContent as GuidelinesContentView, GuidelinesPage as GuidelinesPageView } from './guidelines';
import { QueueItemPage } from './QueueItemPage';
import { QueuePage } from './QueuePage';
import { RulesPage } from './RulesPage';
import { UserDetailPage, UsersPage } from './UsersPage';

export const AdminRoutes: FC = () => (
  <Routes>
    <Route index element={<QueuePage />} />
    <Route path="queue/:id" element={<QueueItemPage />} />
    <Route path="users" element={<UsersPage />} />
    <Route path="users/:id" element={<UserDetailPage />} />
    <Route path="appeals" element={<AppealsPage />} />
    <Route path="audit" element={<AuditPage />} />
    <Route path="analytics" element={<AnalyticsPage />} />
    <Route path="rules" element={<RulesPage />} />
    <Route path="*" element={<Navigate to={routes.admin()} replace />} />
  </Routes>
);

export const GuidelinesPage: FC = () => <GuidelinesPageView />;

export const GuidelinesContent: FC<GuidelinesContentProps> = (props) => <GuidelinesContentView {...props} />;

/**
 * `apartments` slice entry (SPEC §4.6, R5): `ApartmentsPage`, `NotificationsPage`, `SettingsRoutes`, `LegalPage` —
 * names and prop types frozen. Routes (SPEC §4.5): `/apartments` · `/notifications` · `/settings`,
 * `/settings/notifications`, `/settings/privacy`, `/settings/blocked`, `/settings/invite`, `/settings/account-status`,
 * `/settings/buzz-anonymity`, `/settings/about` · `/legal/:doc` (public). No import-time side effects (R4).
 */
import type { FC } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { routes } from '@/lib/links';
import { ApartmentsScreen } from './apartments/ApartmentsPage';
import { LegalScreen } from './LegalPage';
import { NotificationsScreen } from './notifications/NotificationsPage';
import { AboutPage } from './settings/AboutPage';
import { AccountStatusPage } from './settings/AccountStatusPage';
import { BlockedUsersPage } from './settings/BlockedUsersPage';
import { BuzzAnonymityPage } from './settings/BuzzAnonymityPage';
import { InvitePage } from './settings/InvitePage';
import { NotificationSettingsPage } from './settings/NotificationSettingsPage';
import { PrivacyPage } from './settings/PrivacyPage';
import { SettingsHome } from './settings/SettingsHome';

export const ApartmentsPage: FC = () => <ApartmentsScreen />;

export const NotificationsPage: FC = () => <NotificationsScreen />;

export const SettingsRoutes: FC = () => (
  <Routes>
    <Route index element={<SettingsHome />} />
    <Route path="notifications" element={<NotificationSettingsPage />} />
    <Route path="privacy" element={<PrivacyPage />} />
    <Route path="blocked" element={<BlockedUsersPage />} />
    <Route path="invite" element={<InvitePage />} />
    <Route path="account-status" element={<AccountStatusPage />} />
    <Route path="buzz-anonymity" element={<BuzzAnonymityPage />} />
    <Route path="about" element={<AboutPage />} />
    <Route path="*" element={<Navigate to={routes.settings()} replace />} />
  </Routes>
);

export const LegalPage: FC = () => <LegalScreen />;

/**
 * `auth` slice entry (SPEC §4.6, R5): `AuthRoutes: FC` — the six onboarding screens of product §1 under `/welcome/*`
 * (`/welcome`, `/email`, `/code`, `/profile`, `/guidelines`, `/follow`; SPEC §4.5) plus `/password` (D9). Foundation's `RedirectIfReady`
 * wraps this route: ready sessions never reach it, `?next=` / `?invite=` are already in sessionStorage, and a
 * signed-in-but-not-onboarded session is resumed at the right step by each screen's guard.
 *
 * No import-time side effects (R4): the flow store's reset is registered from an effect.
 */
import { useEffect, type FC } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { routes } from '@/lib/links';
import { registerStoreReset } from '@/lib/session';
import { CodeScreen } from './screens/Code';
import { EmailScreen } from './screens/Email';
import { FollowScreen } from './screens/Follow';
import { GuidelinesScreen } from './screens/Guidelines';
import { PasswordScreen } from './screens/Password';
import { ProfileScreen } from './screens/Profile';
import { WelcomeScreen } from './screens/Welcome';
import { resetAuthFlow } from './store';

export const AuthRoutes: FC = () => {
  useEffect(() => registerStoreReset(resetAuthFlow), []);
  return (
    <Routes>
      <Route index element={<WelcomeScreen />} />
      <Route path="email" element={<EmailScreen />} />
      <Route path="code" element={<CodeScreen />} />
      <Route path="password" element={<PasswordScreen />} />
      <Route path="profile" element={<ProfileScreen />} />
      <Route path="guidelines" element={<GuidelinesScreen />} />
      <Route path="follow" element={<FollowScreen />} />
      <Route path="*" element={<Navigate to={routes.welcome()} replace />} />
    </Routes>
  );
};

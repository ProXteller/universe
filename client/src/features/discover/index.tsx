/**
 * `discover` slice entry (SPEC §4.6, R5): `DiscoverRoutes`, `ProfileRoutes`, `EditProfilePage` — names and prop
 * types frozen. Routes (SPEC §4.5): `/discover`, `/discover/search?q=` · `/u/:handle`, `/u/:handle/followers`,
 * `/u/:handle/following` · `/me/edit`. No import-time side effects (R4).
 */
import type { FC } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { routes } from '@/lib/links';
import { DiscoverHomePage } from './DiscoverHome';
import { EditProfilePage as EditProfileScreen } from './EditProfilePage';
import { FollowListPage } from './FollowListPage';
import { ProfilePage } from './ProfilePage';
import { SearchPage } from './SearchPage';

export const DiscoverRoutes: FC = () => (
  <Routes>
    <Route index element={<DiscoverHomePage />} />
    <Route path="search" element={<SearchPage />} />
    <Route path="*" element={<Navigate to={routes.discover()} replace />} />
  </Routes>
);

function ProfileByHandle() {
  const { handle = '' } = useParams<{ handle: string }>();
  return <ProfilePage key={handle.toLowerCase()} handle={handle} />;
}

function FollowersByHandle() {
  const { handle = '' } = useParams<{ handle: string }>();
  return <FollowListPage key={`${handle.toLowerCase()}:followers`} handle={handle} dir="followers" />;
}

function FollowingByHandle() {
  const { handle = '' } = useParams<{ handle: string }>();
  return <FollowListPage key={`${handle.toLowerCase()}:following`} handle={handle} dir="following" />;
}

function ProfileFallback() {
  const { handle = '' } = useParams<{ handle: string }>();
  return <Navigate to={routes.profile(handle)} replace />;
}

/** Mounted at `/u/:handle/*` by the foundation router, so the param is already in scope. */
export const ProfileRoutes: FC = () => (
  <Routes>
    <Route index element={<ProfileByHandle />} />
    <Route path="followers" element={<FollowersByHandle />} />
    <Route path="following" element={<FollowingByHandle />} />
    <Route path="*" element={<ProfileFallback />} />
  </Routes>
);

export const EditProfilePage: FC = () => <EditProfileScreen />;

/**
 * `reels` slice entry (SPEC §4.6, R5): the four frozen exports. No import-time side effects (R4) — every
 * registration (store reset) happens lazily inside the components.
 */
import type { FC } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { HomePaneProps, UserContentProps } from '@/app/contracts';
import { routes } from '@/lib/links';
import { FollowingReelsRail as Rail } from './FollowingReelsRail';
import { ReelPage } from './ReelPage';
import { ReelsPane as Pane } from './ReelsPane';
import { UploadPage } from './UploadPage';
import { UserReelsGrid as Grid } from './UserReelsGrid';

export const ReelsPane: FC<HomePaneProps> = (props) => <Pane {...props} />;

/** `/reel/*`: `/reel/new` and `/reel/:id` (`?comments=1` opens the sheet). */
export const ReelsRoutes: FC = () => (
  <Routes>
    <Route path="new" element={<UploadPage />} />
    <Route path=":id" element={<ReelPage />} />
    <Route path="*" element={<Navigate to={routes.home('reels')} replace />} />
  </Routes>
);

export const UserReelsGrid: FC<UserContentProps> = (props) => <Grid {...props} />;

export const FollowingReelsRail: FC<{ className?: string }> = (props) => <Rail {...props} />;

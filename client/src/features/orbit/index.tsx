/**
 * `orbit` slice entry (SPEC §4.6, R4/R5): frozen export names and prop types; no import-time side effects.
 * Bodies live in the sibling files; this file only re-exports them under the agreed names.
 */
import type { FC } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { HomePaneProps, UserContentProps } from '@/app/contracts';
import { NotFound } from '@/components';
import { OrbitPane as OrbitPaneImpl } from './OrbitPane';
import { PostDetailPage } from './PostDetailPage';
import { UserPostsList as UserPostsListImpl } from './UserPostsList';

export const OrbitPane: FC<HomePaneProps> = (props) => <OrbitPaneImpl {...props} />;

/** Mounted at `/post/*`: the canonical `/post/:id`. */
export const OrbitRoutes: FC = () => (
  <Routes>
    <Route path=":id" element={<PostDetailPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export const UserPostsList: FC<UserContentProps> = (props) => <UserPostsListImpl {...props} />;

/**
 * `buzz` slice entry (SPEC §4.6, R5: names and prop types frozen). No import-time side effects (R4).
 *  - `BuzzPane`  — the Home pane; foundation already wraps it in `<Surface mode="incognito">`.
 *  - `BuzzRoutes` — `/buzz/mine`, `/buzz/search`, `/buzz/:threadId`; each page mounts its own incognito Surface (§4.5).
 */
import type { FC } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { HomePaneProps } from '@/app/contracts';
import { routes } from '@/lib/links';
import { MinePage } from './MinePage';
import { BuzzPane as Pane } from './pane';
import { SearchPage } from './SearchPage';
import { ThreadPage } from './ThreadPage';

export const BuzzPane: FC<HomePaneProps> = ({ active }) => <Pane active={active} />;

export const BuzzRoutes: FC = () => (
  <Routes>
    <Route path="mine" element={<MinePage />} />
    <Route path="search" element={<SearchPage />} />
    <Route path=":threadId" element={<ThreadPage />} />
    <Route path="*" element={<Navigate to={routes.home('buzz')} replace />} />
  </Routes>
);

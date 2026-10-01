/**
 * `roommates` slice entry (SPEC §4.6, R5: the export name is frozen). Nested routes of §4.5:
 * `/roommates` (`?mode=have` pre-filters) · `/roommates/saved` · `/roommates/me` · `/roommates/me/edit` · `/roommates/:id`.
 * No import-time side effects (R4).
 */
import type { FC } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/components';
import { BrowsePage } from './BrowsePage';
import { DetailPage } from './DetailPage';
import { EditorPage } from './EditorPage';
import { MyProfilePage } from './MyProfilePage';
import { SavedPage } from './SavedPage';

export const RoommatesRoutes: FC = () => (
  <Routes>
    <Route index element={<BrowsePage />} />
    <Route path="saved" element={<SavedPage />} />
    <Route path="me" element={<MyProfilePage />} />
    <Route path="me/edit" element={<EditorPage />} />
    <Route path=":id" element={<DetailPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

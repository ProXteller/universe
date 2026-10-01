/**
 * `market` slice entry (SPEC §4.6, R4/R5): the frozen export `MarketRoutes: FC`; no import-time side effects.
 * Mounted at `/market/*`; the canonical sub-paths of SPEC §4.5 are all here:
 *   /market (`?q`, `?course`, `?type`) · /market/new (`?type=wanted&title=`) · /market/saved · /market/mine ·
 *   /market/:id · /market/:id/edit
 */
import type { FC } from 'react';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/components';
import { BrowsePage } from './BrowsePage';
import { CreateListingPage } from './CreateListingPage';
import { EditListingPage } from './EditListingPage';
import { ListingDetailPage } from './ListingDetailPage';
import { MyListingsPage } from './MyListingsPage';
import { SavedPage } from './SavedPage';

export const MarketRoutes: FC = () => (
  <Routes>
    <Route index element={<BrowsePage />} />
    <Route path="new" element={<CreateListingPage />} />
    <Route path="saved" element={<SavedPage />} />
    <Route path="mine" element={<MyListingsPage />} />
    <Route path=":id" element={<ListingDetailPage />} />
    <Route path=":id/edit" element={<EditListingPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

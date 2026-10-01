/**
 * `campus` slice entry (SPEC §4.6, R4/R5): frozen export names and prop types; no import-time side effects.
 * Nested routes of §4.5: `/campus` · `/campus/events` · `/campus/events/new` · `/campus/events/:id` ·
 * `/campus/events/:id/edit` · `/campus/courses`; `CourseJoinPage` is mounted at `/c/:courseId` by foundation.
 */
import type { FC } from 'react';
import { Route, Routes } from 'react-router-dom';
import type { UserContentProps } from '@/app/contracts';
import { NotFound } from '@/components';
import { CourseJoinPage as CourseJoinPageImpl } from './CourseJoinPage';
import { CoursesPage } from './CoursesPage';
import { EventDetailPage } from './EventDetailPage';
import { EventFormPage } from './EventFormPage';
import { EventsPage } from './EventsPage';
import { HubPage } from './HubPage';
import { OrgEventsList as OrgEventsListImpl } from './OrgEventsList';

export const CampusRoutes: FC = () => (
  <Routes>
    <Route index element={<HubPage />} />
    <Route path="events" element={<EventsPage />} />
    <Route path="events/new" element={<EventFormPage />} />
    <Route path="events/:id" element={<EventDetailPage />} />
    <Route path="events/:id/edit" element={<EventFormPage />} />
    <Route path="courses" element={<CoursesPage />} />
    <Route path="*" element={<NotFound />} />
  </Routes>
);

export const CourseJoinPage: FC = () => <CourseJoinPageImpl />;

export const OrgEventsList: FC<UserContentProps> = (props) => <OrgEventsListImpl {...props} />;

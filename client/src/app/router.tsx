/**
 * Client route table (SPEC §4.5). Every slice element is `React.lazy` on its `features/<slice>` entry inside
 * `<Suspense fallback={<PageLoader/>}>` + a `RouteError` boundary. Wildcard mounts (`/*`) give the slice its own
 * nested `<Routes>`. Guards: `P` = `RedirectIfReady`, `A` = `RequireOnboarded` (+ `RequireStaff` on `/admin/*`).
 */
import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { NotFound, PageLoader, RouteError } from '@/components';
import { routes } from '@/lib/links';
import { readLastTab } from '@/stores/home';
import { RedirectIfReady, RequireOnboarded, RequireStaff } from './guards';
import { HomePage } from './home/HomePage';
import { InviteRedirect } from './InviteRedirect';

type Mod<K extends string> = Record<K, ComponentType>;
function pick<K extends string>(load: () => Promise<Mod<K>>, key: K) {
  return lazy(() => load().then((m) => ({ default: m[key] })));
}

const AuthRoutes = pick(() => import('@/features/auth'), 'AuthRoutes');
const ReelsRoutes = pick(() => import('@/features/reels'), 'ReelsRoutes');
const BuzzRoutes = pick(() => import('@/features/buzz'), 'BuzzRoutes');
const OrbitRoutes = pick(() => import('@/features/orbit'), 'OrbitRoutes');
const DiscoverRoutes = pick(() => import('@/features/discover'), 'DiscoverRoutes');
const ProfileRoutes = pick(() => import('@/features/discover'), 'ProfileRoutes');
const EditProfilePage = pick(() => import('@/features/discover'), 'EditProfilePage');
const MessagesRoutes = pick(() => import('@/features/messages'), 'MessagesRoutes');
const RoommatesRoutes = pick(() => import('@/features/roommates'), 'RoommatesRoutes');
const MarketRoutes = pick(() => import('@/features/market'), 'MarketRoutes');
const ApartmentsPage = pick(() => import('@/features/apartments'), 'ApartmentsPage');
const NotificationsPage = pick(() => import('@/features/apartments'), 'NotificationsPage');
const SettingsRoutes = pick(() => import('@/features/apartments'), 'SettingsRoutes');
const LegalPage = pick(() => import('@/features/apartments'), 'LegalPage');
const CampusRoutes = pick(() => import('@/features/campus'), 'CampusRoutes');
const CourseJoinPage = pick(() => import('@/features/campus'), 'CourseJoinPage');
const GuidelinesPage = pick(() => import('@/features/admin'), 'GuidelinesPage');
const AdminRoutes = pick(() => import('@/features/admin'), 'AdminRoutes');
/** Dev-only (DECISIONS D1): the constant folds to `null` in production, so the gallery chunk is not built at all. */
const KitGallery = import.meta.env.DEV ? pick(() => import('./dev/KitGallery'), 'KitGallery') : null;

/** Suspense + error boundary around a lazy slice element. */
function Lazy({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <RouteError title={title}>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
    </RouteError>
  );
}

/** `A` guard + lazy wrapper in one. */
function A({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <RequireOnboarded>
      <Lazy title={title}>{children}</Lazy>
    </RequireOnboarded>
  );
}

function HomeRedirect() {
  return <Navigate to={routes.home(readLastTab())} replace />;
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/welcome/*"
        element={
          <RedirectIfReady>
            <Lazy title="Couldn't load sign-in">
              <AuthRoutes />
            </Lazy>
          </RedirectIfReady>
        }
      />
      <Route path="/i/:code" element={<InviteRedirect />} />

      <Route
        path="/"
        element={
          <RequireOnboarded>
            <HomeRedirect />
          </RequireOnboarded>
        }
      />
      <Route
        path="/home/:tab"
        element={
          <RequireOnboarded>
            <HomePage />
          </RequireOnboarded>
        }
      />

      <Route path="/reel/*" element={<A title="Couldn't load Reels"><ReelsRoutes /></A>} />
      <Route path="/buzz/*" element={<A title="Couldn't load Buzz"><BuzzRoutes /></A>} />
      <Route path="/post/*" element={<A title="Couldn't load this post"><OrbitRoutes /></A>} />
      <Route path="/discover/*" element={<A title="Couldn't load Discover"><DiscoverRoutes /></A>} />
      <Route path="/u/:handle/*" element={<A title="Couldn't load this profile"><ProfileRoutes /></A>} />
      <Route path="/me/edit" element={<A title="Couldn't load your profile"><EditProfilePage /></A>} />
      <Route path="/messages/*" element={<A title="Couldn't load Messages"><MessagesRoutes /></A>} />
      <Route path="/roommates/*" element={<A title="Couldn't load Roommates"><RoommatesRoutes /></A>} />
      <Route path="/market/*" element={<A title="Couldn't load Marketplace"><MarketRoutes /></A>} />
      <Route path="/apartments" element={<A title="Couldn't load Apartments"><ApartmentsPage /></A>} />
      <Route path="/notifications" element={<A title="Couldn't load Notifications"><NotificationsPage /></A>} />
      <Route path="/settings/*" element={<A title="Couldn't load Settings"><SettingsRoutes /></A>} />
      <Route path="/legal/:doc" element={<Lazy><LegalPage /></Lazy>} />
      <Route path="/campus/*" element={<A title="Couldn't load Campus"><CampusRoutes /></A>} />
      <Route path="/c/:courseId" element={<A title="Couldn't load this course"><CourseJoinPage /></A>} />
      <Route path="/guidelines" element={<Lazy><GuidelinesPage /></Lazy>} />
      <Route
        path="/admin/*"
        element={
          <RequireOnboarded>
            <RequireStaff>
              <Lazy title="Couldn't load Trust & Safety">
                <AdminRoutes />
              </Lazy>
            </RequireStaff>
          </RequireOnboarded>
        }
      />

      {KitGallery ? <Route path="/dev/kit" element={<Lazy><KitGallery /></Lazy>} /> : null}

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

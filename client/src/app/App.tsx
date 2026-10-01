/**
 * App (SPEC §4.4.3): providers (QueryClient, Router), the imperative-navigation bridge for non-component code,
 * the session boot (`GET /me` once), `app_open`, then the shell around the route table.
 */
import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { setNavigator } from '@/lib/navigation';
import { queryClient } from '@/lib/query';
import { refreshMe } from '@/lib/session';
import { AppShell } from './AppShell';
import { AppRouter } from './router';

/** Hands the router's `navigate` to `lib/navigation.ts` (api.ts redirects, `openDm`, `logout`, ws revocation). */
function NavigatorBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator(navigate);
    return () => setNavigator(null);
  }, [navigate]);
  return null;
}

let booted = false;

/** One `GET /me` per page load; `app_open` is a pre-auth analytics event (#33) so it fires signed-out too. */
function SessionBoot() {
  useEffect(() => {
    if (booted) return;
    booted = true;
    void refreshMe().then(() => track('app_open'));
  }, []);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NavigatorBridge />
        <SessionBoot />
        <AppShell>
          <AppRouter />
        </AppShell>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;

/**
 * AppShell (design §6.1, SPEC §4.4.3): the phone frame over the aurora backdrop, `#screen-root` for routes,
 * the floating BottomNav, the overlay hosts (report / block / share / moderation / Me sheet / SanctionGate /
 * Toaster) and `#overlay-root` (portal target; absolute inset-0 inside the frame — nothing is position:fixed).
 * Also keeps the realtime socket alive while the session is ready and registers foundation store resets.
 */
import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Toaster } from '@/ui';
import { BlockHost, ModerationHost, ReportHost, SanctionGate, ShareHost } from '@/components';
import { useRealtimeConnection } from '@/lib/realtime';
import { registerStoreReset } from '@/lib/session';
import { resetHomeStore, useHomeStore } from '@/stores/home';
import { useUiStore } from '@/stores/ui';
import { AuroraBackdrop, BrandBlock } from './AuroraBackdrop';
import { BottomNav } from './BottomNav';
import { MeSheet } from './home/MeSheet';

function useFoundationResets(): void {
  useEffect(() => {
    const offHome = registerStoreReset(resetHomeStore);
    const offUi = registerStoreReset(() => useUiStore.getState().reset());
    return () => {
      offHome();
      offUi();
    };
  }, []);
}

/** Toasts follow the Buzz world while Home rests on Buzz (no violet chrome there). */
function ShellToaster() {
  const { pathname } = useLocation();
  const tab = useHomeStore((s) => s.tab);
  const incognito =
    pathname === '/buzz' || pathname.startsWith('/buzz/') || (pathname.startsWith('/home') && tab === 'buzz');
  return <Toaster mode={incognito ? 'incognito' : 'public'} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  useRealtimeConnection();
  useFoundationResets();
  return (
    <>
      <AuroraBackdrop />
      <BrandBlock />
      <div id="frame">
        <div id="screen-root">{children}</div>
        <BottomNav />
        <SanctionGate />
        <div id="overlay-root" />
        <MeSheet />
        <ReportHost />
        <BlockHost />
        <ShareHost />
        <ModerationHost />
        <ShellToaster />
      </div>
    </>
  );
}

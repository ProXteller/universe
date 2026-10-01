/**
 * `/i/:code` → `/welcome?invite=<code>` (SPEC §4.4.3). The code is also kept in sessionStorage by foundation so it
 * survives the whole auth flow; `invite_link_opened` is a pre-auth analytics event (#33).
 */
import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { setPendingInvite } from '@/lib/session';

export function InviteRedirect() {
  const { code = '' } = useParams<{ code: string }>();
  useEffect(() => {
    if (!code) return;
    setPendingInvite(code);
    track('invite_link_opened', { code });
  }, [code]);
  if (!code) return <Navigate to={routes.welcome()} replace />;
  return <Navigate to={`${routes.welcome()}?invite=${encodeURIComponent(code)}`} replace />;
}

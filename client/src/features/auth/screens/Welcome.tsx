/**
 * 1.1 Welcome (product §1.1, design §7.1). Full-bleed canvas: orbit illustration (top ~55 %), wordmark, promise,
 * invite pill (only with a valid `?invite=`), hero CTA, caption, "How verification works" sheet, Terms / Privacy.
 * Step resolution: a mid-onboarding session resumes at its step; a stored signup token resumes at the profile.
 */
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Mail } from 'lucide-react';
import { Button, Screen, Sheet } from '@/ui';
import { UserAvatar, Wordmark } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { firstName } from '@/lib/format';
import { routes } from '@/lib/links';
import { getPendingInvite, useMeOptional, useSessionStatus } from '@/lib/session';
import { authApi, authKeys } from '../api';
import { OrbitIllustration } from '../OrbitIllustration';
import { resumePath } from '../shared';
import { useAuthFlow } from '../store';

function InvitePill({ code }: { code: string }) {
  const q = useQuery({
    queryKey: authKeys.invite(code),
    queryFn: () => authApi.invitePreview(code),
    staleTime: 5 * 60_000,
    retry: false,
  });
  if (!q.data) return null; // 404 / loading: nothing (an invalid invite never blocks sign-up)
  const { inviter, universityName } = q.data;
  return (
    <div className="flex items-center gap-2.5 self-start rounded-full border border-accent-line bg-accent-soft py-1.5 pr-3.5 pl-1.5">
      <UserAvatar user={inviter} size="sm" link={false} />
      <span className="truncate type-label-sm text-ink">
        {firstName(inviter.displayName)} invited you · {universityName}
      </span>
    </div>
  );
}

export function WelcomeScreen() {
  const navigate = useNavigate();
  const me = useMeOptional();
  const status = useSessionStatus();
  const signupToken = useAuthFlow((s) => s.signupToken);
  const [params] = useSearchParams();
  const [howOpen, setHowOpen] = useState(false);
  // The URL wins on first paint (foundation copies `?invite=` into sessionStorage in an effect, i.e. after this render).
  const invite = params.get('invite') ?? getPendingInvite();
  useScreenView('welcome');

  if (status === 'onboarding' && me) return <Navigate to={resumePath(me)} replace />;
  if (signupToken) return <Navigate to={routes.welcomeStep('profile')} replace />;

  return (
    <Screen bleed>
      <div className="relative flex flex-1 flex-col">
        <OrbitIllustration className="h-[44cqh] min-h-56 shrink-0" />
        <div className="flex flex-1 flex-col justify-end gap-5 px-5 pb-2">
          <div className="flex flex-col gap-3">
            <Wordmark size="display" />
            <h1 className="type-title-1 text-ink">Your whole campus. One app.</h1>
            <p className="type-body-lg text-ink-2">
              Reels, anonymous Buzz, roommates, marketplace and class chats — for verified students only.
            </p>
            {invite ? <InvitePill code={invite} /> : null}
          </div>
          <div className="flex flex-col gap-3">
            <Button variant="hero" size="lg" fullWidth leftIcon={Mail} onClick={() => navigate(routes.welcomeStep('email'))}>
              Continue with university email
            </Button>
            <p className="flex items-center justify-center gap-1.5 type-caption text-ink-3">
              <GraduationCap size={14} strokeWidth={2} aria-hidden />
              Only verified students and campus orgs
            </p>
            <button
              type="button"
              onClick={() => setHowOpen(true)}
              className="press mx-auto min-h-11 rounded-sm px-2 type-label-sm text-accent-ink"
            >
              How verification works
            </button>
          </div>
          <p className="text-center type-caption text-ink-3">
            By continuing you agree to the{' '}
            <Link to={routes.legal('terms')} className="text-ink-2 underline underline-offset-2">
              Terms
            </Link>{' '}
            and{' '}
            <Link to={routes.legal('privacy')} className="text-ink-2 underline underline-offset-2">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>

      <Sheet open={howOpen} onOpenChange={setHowOpen} title="How verification works">
        <p className="pb-2 type-body text-ink-2">
          We email a 6-digit code to your university address (or use a password, if you set one). We never post for you and we never contact anyone on your behalf.
        </p>
      </Sheet>
    </Screen>
  );
}

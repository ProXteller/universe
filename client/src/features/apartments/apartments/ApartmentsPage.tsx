/**
 * Apartments — Coming soon (SPEC §5.10, design §7.7, product §2.10). Nav visible, no PageHeader: one composed poster,
 * three promises, the hero "Get notified" CTA (optimistic morph + ring pulse, real campus count), the micro-survey
 * after joining, the roommates cross-link and a share action. Every tap is tracked through `track()`; `page_view`
 * fires once per session with its source, `dwell` on leave.
 */
import { useEffect, useRef, useState, type FC, type ReactNode } from 'react';
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, Bell, Check, ChevronRight, Footprints, Home, KeyRound, Share2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SurveyQuestionId, SurveySplit } from '@shared/apartments';
import { Button, Card, ErrorState, Screen, Skeleton } from '@/ui';
import { track, useDwell } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { routes } from '@/lib/links';
import { motionSafe, spring, useReducedMotionPref, useSpringPreset } from '@/lib/motion';
import { useMe } from '@/lib/session';
import { absoluteUrl, copyLink } from '@/lib/share';
import { toast } from '@/lib/toast';
import { useAnswerSurvey, useSurvey, useWaitlist, useWaitlistToggle } from '../api';
import { Skyline } from './Skyline';
import { SurveyCard } from './SurveyCard';

const VIEWED_KEY = 'uv:apartments:viewed';
type Source = 'nav' | 'campus' | 'link';

const PROMISES: { icon: LucideIcon; text: string }[] = [
  { icon: Footprints, text: 'Listings near campus, sorted by walk time to class.' },
  { icon: BadgeCheck, text: 'Building reviews from verified students.' },
  { icon: KeyRound, text: 'Sublets and lease takeovers, students only.' },
];

/** `page_view` once per session; the source comes from router state / `?source=` (campus hub) or the navigation type. */
function usePageView(): Source {
  const location = useLocation();
  const [params] = useSearchParams();
  const navType = useNavigationType();
  const sourceRef = useRef<Source | null>(null);
  if (sourceRef.current === null) {
    const stateSource = (location.state as { source?: unknown } | null)?.source;
    const param = params.get('source');
    sourceRef.current = stateSource === 'campus' || param === 'campus' ? 'campus' : navType === 'POP' ? 'link' : 'nav';
  }
  useEffect(() => {
    try {
      if (sessionStorage.getItem(VIEWED_KEY)) return;
      sessionStorage.setItem(VIEWED_KEY, '1');
    } catch {
      /* private mode: track anyway */
    }
    track('apartments.page_view', { source: sourceRef.current ?? 'nav' });
  }, []);
  return sourceRef.current;
}

const PromiseRow: FC<{ icon: LucideIcon; text: string }> = ({ icon: Icon, text }) => (
  <li className="flex items-center gap-3">
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent-ink">
      <Icon size={18} strokeWidth={1.75} />
    </span>
    <span className="type-body text-ink-2">{text}</span>
  </li>
);

export const ApartmentsScreen: FC = () => {
  const me = useMe();
  const source = usePageView();
  useDwell('apartments.dwell');
  const reduced = useReducedMotionPref();
  const bouncy = useSpringPreset('bouncy');

  const waitlist = useWaitlist();
  const toggle = useWaitlistToggle();
  const joined = waitlist.data?.joined ?? false;
  const survey = useSurvey(joined);
  const answerMutation = useAnswerSurvey();
  const [pulseKey, setPulseKey] = useState(0);

  const university = me.university.name;
  const count = waitlist.data?.campusCount ?? 0;

  const join = () => {
    track('apartments.cta_click', { source });
    setPulseKey((k) => k + 1);
    toggle.mutate({ join: true, source }, { onError: (e) => toast.error(errorMessage(e)) });
  };
  const leave = () => {
    track('apartments.cta_undo');
    toggle.mutate({ join: false, source }, { onError: (e) => toast.error(errorMessage(e)) });
  };

  const share = async () => {
    const url = absoluteUrl(routes.apartments());
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      track('apartments.share_click', { method: 'native' });
      try {
        await nav.share({ title: 'Apartments on UniVerse', text: `Get notified when Apartments launches at ${university}.`, url });
        return;
      } catch {
        /* dismissed or unsupported payload → copy instead */
      }
    }
    track('apartments.share_click', { method: 'copy' });
    await copyLink(url);
  };

  const answer = (question: SurveyQuestionId, value: string[]): Promise<SurveySplit> => answerMutation.mutateAsync({ question, answer: value });

  let cta: ReactNode;
  if (waitlist.isLoading) {
    cta = (
      <div className="flex flex-col items-center gap-3" aria-busy="true" aria-label="Loading">
        <Skeleton w="100%" h={52} className="rounded-full" />
        <Skeleton w={200} h={12} />
      </div>
    );
  } else if (waitlist.isError || !waitlist.data) {
    cta = <ErrorState inline title="Couldn't load the waitlist." error={waitlist.error} onRetry={() => void waitlist.refetch()} />;
  } else {
    cta = (
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-full">
          <AnimatePresence>
            {pulseKey > 0 && joined && !reduced ? (
              <motion.span
                key={pulseKey}
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-accent"
                initial={{ opacity: 0.9, scale: 1 }}
                animate={{ opacity: 0, scale: 1.18 }}
                transition={{ ...spring.gentle, opacity: { duration: 0.7 } }}
              />
            ) : null}
          </AnimatePresence>
          <motion.div key={joined ? 'joined' : 'join'} initial={{ scale: reduced ? 1 : 0.96 }} animate={{ scale: 1 }} transition={bouncy}>
            {joined ? (
              <Button variant="secondary" size="lg" fullWidth leftIcon={Check} onClick={leave} aria-label="You're on the list. Tap to leave the list">
                You're on the list
              </Button>
            ) : (
              <Button variant="hero" size="lg" fullWidth leftIcon={Bell} onClick={join}>
                Get notified
              </Button>
            )}
          </motion.div>
        </div>
        <p className="type-caption tabular-nums text-ink-3" aria-live="polite">
          {count >= 10 ? `${count} students at ${university} are waiting.` : `Be one of the first at ${university}.`}
        </p>
        {joined ? (
          <button type="button" onClick={leave} className="type-caption text-ink-3 underline-offset-2 hover:text-ink-2 hover:underline">
            Leave the list
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <Screen nav>
      <div className="flex flex-col gap-6 px-4 pb-4">
        {/* poster */}
        <div className="relative -mx-4 overflow-hidden px-4 pt-2">
          <Skyline className="mx-auto max-w-[360px]" />
          <div className="mt-2 flex flex-col gap-2">
            <span className="type-overline text-ink-3">Apartments</span>
            <h1 className="type-display text-ink">
              Coming <span className="text-hero">soon</span>
            </h1>
            <p className="type-body-lg text-ink-2">Find a place near campus with people you can actually verify.</p>
          </div>
        </div>

        <ul className="flex flex-col gap-3" aria-label="What Apartments will do">
          {PROMISES.map((p) => (
            <PromiseRow key={p.text} icon={p.icon} text={p.text} />
          ))}
        </ul>

        {cta}

        <AnimatePresence initial={false}>
          {joined ? (
            <motion.div key="survey" initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={motionSafe(spring.smooth, reduced)}>
              <SurveyCard state={survey.data} isLoading={survey.isLoading} error={survey.error} onRetry={() => void survey.refetch()} university={university} answer={answer} />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Card interactive to={routes.roommates({ mode: 'have' })} onClick={() => track('apartments.roommates_crosslink_click')} aria-label="Need a place now? See roommates who already have a room">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
              <Home size={20} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="type-headline text-ink">Need a place now?</p>
              <p className="type-footnote text-ink-2">See roommates who already have a room.</p>
            </div>
            <ChevronRight size={18} strokeWidth={2} aria-hidden className="shrink-0 text-ink-4" />
          </div>
        </Card>

        <div className="flex flex-col items-center gap-2">
          <Button variant="ghost" size="sm" leftIcon={Share2} onClick={() => void share()}>
            Share Apartments
          </Button>
          <p className="max-w-[32ch] text-center type-caption text-ink-4">Taps on this page help decide which campuses launch first. No listings yet, nothing to browse.</p>
        </div>
      </div>
    </Screen>
  );
};

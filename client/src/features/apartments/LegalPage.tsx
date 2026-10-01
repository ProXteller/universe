/**
 * `/legal/:doc` — static Terms / Privacy (public: the Welcome footer links here, so nothing needs a session).
 */
import type { FC } from 'react';
import { useParams } from 'react-router-dom';
import { APP_NAME } from '@shared/core';
import { PageHeader, Screen } from '@/ui';
import { NotFound } from '@/components';
import { Prose } from './settings/shared';

const UPDATED = 'September 2026';

const Terms: FC = () => (
  <Prose>
    <p>These terms cover your use of {APP_NAME}. Short version: be a real student, be decent, and keep other people's information to yourself.</p>
    <h2>1. Who can use {APP_NAME}</h2>
    <p>
      You need a current university email address to sign up, and you must be a student, staff member or recognised student organisation at that
      university. One person, one account. Organisation accounts are run by the people the organisation names.
    </p>
    <h2>2. Two identities</h2>
    <p>
      Your public profile is you. Buzz is anonymous to other students: it shows a per-thread alias and never your profile. Anonymity is not a licence —
      Buzz is monitored under the Community Guidelines, and an admin may connect a buzz to an account only through a written-reason, audited request in
      serious safety cases.
    </p>
    <h2>3. Your content</h2>
    <p>
      You own what you post. You give {APP_NAME} a licence to store, display and distribute it inside the app so the features work (feeds, profiles,
      chats, share cards). Deleting content removes it from the app; copies kept for safety review are deleted on a schedule.
    </p>
    <h2>4. What is not allowed</h2>
    <ul>
      <li>Harassment, bullying, hate, threats or violence of any kind.</li>
      <li>Sexual content involving minors, or unwanted sexual advances.</li>
      <li>Selling drugs, weapons or anything else illegal; scams and spam.</li>
      <li>Sharing someone's private information, impersonation, or naming people in accusations.</li>
      <li>Academic dishonesty: selling or soliciting completed coursework or exam answers.</li>
    </ul>
    <h2>5. Enforcement</h2>
    <p>
      Content that breaks the guidelines can be hidden or removed; accounts can receive a warning, a mute, a suspension or a ban, in that order for most
      cases and immediately for the worst ones. Every restriction is shown to you in Account status and can be appealed once within 14 days. A
      different reviewer handles the appeal.
    </p>
    <h2>6. Marketplace and roommates</h2>
    <p>
      {APP_NAME} does not handle payments, shipping or leases. Meet in public campus spots, pay in person, and treat listings and roommate posts as
      introductions between students — not as offers by {APP_NAME}.
    </p>
    <h2>7. Ending things</h2>
    <p>
      You can delete your account from Settings at any time. Your handle stays retired so nobody can impersonate you afterwards. We may suspend or end
      accounts that break these terms or the guidelines.
    </p>
    <h2>8. Changes</h2>
    <p>When these terms change in a way that matters, we say so in the app before it takes effect. Last updated {UPDATED}.</p>
  </Prose>
);

const Privacy: FC = () => (
  <Prose>
    <p>{APP_NAME} collects the minimum it needs to run a campus community, and never sells your data.</p>
    <h2>What we collect</h2>
    <ul>
      <li>Your university email (to verify you), your profile, and what you post, save and send.</li>
      <li>Product analytics: which screens you open and which buttons you tap, with your account, campus and time. Buzz analytics are stored without
        your account id.</li>
      <li>Reports you file, and moderation records about your own content.</li>
    </ul>
    <h2>How we use it</h2>
    <ul>
      <li>To run the app: feeds, chats, notifications, roommate matching, the Apartments waitlist.</li>
      <li>To keep people safe: automated checks on text at posting time, human review of reports, and rate limits.</li>
      <li>To decide what to build next — for example, which campuses get Apartments first.</li>
    </ul>
    <h2>Anonymity on Buzz</h2>
    <p>
      Buzz posts are stored with your account for moderation only. Other students see a per-thread alias. Moderators act on content without seeing
      identity; only an admin can unmask, only with a written reason, and every unmask is logged and audited.
    </p>
    <h2>Who can see what</h2>
    <p>
      Your public profile and public posts are visible to other verified students. Messages are visible only to their members. Blocking someone hides
      you from each other everywhere except Buzz, which has no identities to hide.
    </p>
    <h2>Retention and deletion</h2>
    <p>
      Deleting your account blanks your profile and removes your content from the app. Safety records tied to reports are kept for a limited period,
      then deleted. Sign-in codes expire after ten minutes.
    </p>
    <h2>Your controls</h2>
    <ul>
      <li>Settings → Privacy & safety: who can message you, presence, blocked users.</li>
      <li>Settings → Notifications: per-category toggles and quiet hours.</li>
      <li>Settings → Account status: every notice about your account, with a one-tap appeal.</li>
    </ul>
    <p>Last updated {UPDATED}.</p>
  </Prose>
);

export const LegalScreen: FC = () => {
  const { doc } = useParams<{ doc: string }>();
  if (doc !== 'terms' && doc !== 'privacy') return <NotFound />;
  const terms = doc === 'terms';
  return (
    <Screen header={<PageHeader title={terms ? 'Terms of Service' : 'Privacy Policy'} subtitle={`Updated ${UPDATED}`} mode="compact" back />} className="px-4 pb-6 pt-2">
      {terms ? <Terms /> : <Privacy />}
    </Screen>
  );
};

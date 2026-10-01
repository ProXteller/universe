/**
 * Settings → How Buzz anonymity works (Constitution §5, in plain words). Static; links to the guidelines anchor.
 */
import type { FC } from 'react';
import { BookOpen, VenetianMask } from 'lucide-react';
import { Button, Card } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { Prose, SettingsScreen } from './shared';

export const BuzzAnonymityPage: FC = () => {
  useScreenView('settings_buzz_anonymity');
  return (
    <SettingsScreen title="How Buzz anonymity works">
      <Card className="flex items-center gap-3 bg-incog-surface-2">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-incog-surface-3 text-incog-500">
          <VenetianMask size={20} strokeWidth={1.75} />
        </span>
        <p className="type-headline text-incog-ink">Anonymous to students. Monitored by the developers.</p>
      </Card>
      <Prose>
        <h2>What other students see</h2>
        <p>
          Every buzz and reply shows an alias like “Anon Comet” instead of your profile. The alias is derived from the thread and your account, so it stays
          the same inside one thread and cannot be matched across threads. Nothing in Buzz links to your name, handle, avatar or campus profile.
        </p>
        <h2>Where Buzz never appears</h2>
        <ul>
          <li>Your public profile, Discover and Orbit never show anything you posted in Buzz.</li>
          <li>Buzz notifications never carry a name — only “Someone replied to your buzz”.</li>
          <li>Following or blocking someone has no effect inside Buzz, in either direction.</li>
        </ul>
        <h2>What the developers can see</h2>
        <p>
          Buzz is monitored under the Community Guidelines. Moderators act on content without seeing who wrote it. Only an admin can connect a buzz to an
          account, only through a written-reason request that is recorded in a permanent audit log, and only for serious safety cases such as threats,
          harassment campaigns or content involving minors.
        </p>
        <h2>What you control</h2>
        <ul>
          <li>Delete any of your buzzes from My buzzes at any time.</li>
          <li>Hide a thread, or mute an alias inside a thread, when you do not want to see it.</li>
          <li>Report anything that breaks the guidelines — reports are reviewed within a day.</li>
        </ul>
      </Prose>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" fullWidth leftIcon={BookOpen} to={routes.guidelines('buzz-anonymity')}>
          Read it in the guidelines
        </Button>
        <Button variant="ghost" fullWidth leftIcon={VenetianMask} to={routes.buzzMine()}>
          My buzzes
        </Button>
      </div>
    </SettingsScreen>
  );
};

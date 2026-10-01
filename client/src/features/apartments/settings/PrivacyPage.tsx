/**
 * Settings → Privacy & safety: who can message me (Select), presence, Blocked users, My buzzes, How Buzz anonymity works.
 */
import type { FC } from 'react';
import { Ban, Eye, VenetianMask } from 'lucide-react';
import type { WhoCanMessage } from '@shared/core';
import { ListRow, Select, Switch } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { routes } from '@/lib/links';
import { toast } from '@/lib/toast';
import { useSettings, useUpdateSettings } from '../api';
import { Group, RowIcon, SettingsScreen } from './shared';

const WHO: readonly { value: WhoCanMessage; label: string; description: string }[] = [
  { value: 'everyone', label: 'Everyone', description: 'Anyone on UniVerse can send a request' },
  { value: 'campus', label: 'Only my campus', description: 'Students and orgs at your university' },
  { value: 'following', label: 'People I follow', description: 'Nobody new can start a chat' },
];

export const PrivacyPage: FC = () => {
  const settings = useSettings();
  const update = useUpdateSettings();
  useScreenView('settings_privacy');
  const s = settings.data;
  const patch = (p: Parameters<typeof update.mutate>[0]) => update.mutate(p, { onError: (e) => toast.error(errorMessage(e)) });

  return (
    <SettingsScreen title="Privacy & safety">
      <Group label="Messages" description="People you already chat with are never affected. Requests from strangers wait in your Requests tab.">
        <div className="px-4 py-3">
          <Select<WhoCanMessage>
            label="Who can message me"
            value={s?.whoCanMessage ?? null}
            onChange={(v) => patch({ whoCanMessage: v })}
            options={WHO}
            sheetTitle="Who can message me"
            disabled={!s}
          />
        </div>
        <ListRow
          leading={<RowIcon icon={Eye} />}
          title={<span id="privacy-presence">Show when I'm active</span>}
          subtitle="Only to people you have accepted a chat with"
          trailing={<Switch checked={s?.showPresence ?? true} onChange={(v) => patch({ showPresence: v })} disabled={!s} aria-labelledby="privacy-presence" />}
        />
      </Group>

      <Group label="Safety">
        <ListRow leading={<RowIcon icon={Ban} tone="danger" />} title="Blocked users" subtitle="Unblock anyone here" to={routes.settings('blocked')} trailing="chevron" />
      </Group>

      <Group label="Buzz" description="Buzz is fully anonymous to other students. Your public profile never links to it.">
        <ListRow leading={<RowIcon icon={VenetianMask} tone="incognito" />} title="My buzzes" subtitle="Everything you posted anonymously" to={routes.buzzMine()} trailing="chevron" />
        <ListRow leading={<RowIcon icon={VenetianMask} tone="incognito" />} title="How Buzz anonymity works" to={routes.settings('buzz-anonymity')} trailing="chevron" />
      </Group>
    </SettingsScreen>
  );
};

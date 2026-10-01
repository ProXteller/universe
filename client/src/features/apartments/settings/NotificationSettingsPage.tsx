/**
 * Settings → Notifications: one Switch per `NotificationCategory` (safety is always on) + quiet hours (T2).
 * Foundation #13 (PATCH /me/settings), optimistic.
 */
import type { FC } from 'react';
import { Moon } from 'lucide-react';
import type { NotificationCategory } from '@shared/core';
import { Input, ListRow, Switch } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useSettings, useUpdateSettings } from '../api';
import { Group, RowIcon, SettingsScreen } from './shared';

const CATEGORIES: readonly { id: Exclude<NotificationCategory, 'safety'>; label: string; hint: string }[] = [
  { id: 'follows', label: 'Follows', hint: 'Someone started following you' },
  { id: 'replies', label: 'Replies & comments', hint: 'On your reels, posts and buzzes' },
  { id: 'likes', label: 'Likes', hint: 'Collapsed per reel or post' },
  { id: 'messages', label: 'Messages', hint: 'Requests, accepts, groups' },
  { id: 'marketplace', label: 'Marketplace', hint: 'Offers and price drops' },
  { id: 'roommates', label: 'Roommates', hint: '“Still looking?” check-ins' },
  { id: 'events', label: 'Events', hint: 'RSVPs, reminders, changes' },
  { id: 'buzz', label: 'Buzz', hint: 'Anonymous replies and milestones' },
  { id: 'system', label: 'Announcements', hint: 'From the UniVerse team' },
];

const toTime = (min: number): string => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromTime = (v: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
};

export const NotificationSettingsPage: FC = () => {
  const settings = useSettings();
  const update = useUpdateSettings();
  useScreenView('settings_notifications');
  const s = settings.data;
  const patch = (p: Parameters<typeof update.mutate>[0]) => update.mutate(p, { onError: (e) => toast.error(errorMessage(e)) });

  if (!s) return <SettingsScreen title="Notifications">{null}</SettingsScreen>;

  return (
    <SettingsScreen title="Notifications">
      <Group label="Categories" description="Safety notices always arrive: they are how we tell you about your own account.">
        {CATEGORIES.map((c) => (
          <ListRow
            key={c.id}
            title={<span id={`notif-${c.id}`}>{c.label}</span>}
            subtitle={c.hint}
            trailing={<Switch checked={s.notifications[c.id]} onChange={(v) => patch({ notifications: { [c.id]: v } })} aria-labelledby={`notif-${c.id}`} />}
          />
        ))}
        <ListRow
          title={<span id="notif-safety">Safety</span>}
          subtitle="Always on"
          trailing={<Switch checked disabled onChange={() => undefined} aria-labelledby="notif-safety" />}
        />
      </Group>

      <Group label="Quiet hours" description="Pushes pause overnight; everything still lands in your Notifications.">
        <ListRow
          leading={<RowIcon icon={Moon} />}
          title={<span id="quiet-enabled">Quiet hours</span>}
          subtitle={`${toTime(s.quietHours.startMin)} – ${toTime(s.quietHours.endMin)}`}
          trailing={<Switch checked={s.quietHours.enabled} onChange={(v) => patch({ quietHours: { enabled: v } })} aria-labelledby="quiet-enabled" />}
        />
        {s.quietHours.enabled ? (
          <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-1">
            <Input
              label="From"
              type="time"
              value={toTime(s.quietHours.startMin)}
              onChange={(e) => {
                const v = fromTime(e.target.value);
                if (v !== null) patch({ quietHours: { startMin: v } });
              }}
            />
            <Input
              label="Until"
              type="time"
              value={toTime(s.quietHours.endMin)}
              onChange={(e) => {
                const v = fromTime(e.target.value);
                if (v !== null) patch({ quietHours: { endMin: v } });
              }}
            />
          </div>
        ) : null}
      </Group>
    </SettingsScreen>
  );
};

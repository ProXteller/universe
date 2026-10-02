/**
 * Settings home (SPEC §5.10, design §7.9): Account (+ Password & sign-in, D9) · Notifications · Privacy & safety · Appearance · Invite friends ·
 * Account status · About · Trust & Safety (staff) · Sign out · Delete account (typed DELETE → foundation #20).
 */
import { useState, type FC } from 'react';
import { Bell, GraduationCap, Info, KeyRound, LogOut, Mail, Scale, Shield, ShieldCheck, Sparkles, Trash2, UserPen, UserPlus } from 'lucide-react';
import { CATEGORY_LABELS } from '@shared/core';
import { Button, Dialog, Input, ListRow, Switch, VerifiedBadge } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { routes } from '@/lib/links';
import { logout, useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { deleteAccount, useSettings, useUpdateSettings } from '../api';
import { Group, RowIcon, SettingsScreen } from './shared';

function standingLine(me: ReturnType<typeof useMe>): string {
  const s = me.activeSanction;
  if (!s) return 'Good standing';
  const what = s.kind === 'mute' ? 'Muted' : s.kind === 'suspension' ? 'Suspended' : 'Banned';
  const until = s.until ? ` until ${formatDate(s.until)}` : '';
  const why = s.category ? ` · ${CATEGORY_LABELS[s.category]}` : '';
  return `${what}${until}${why}`;
}

export const SettingsHome: FC = () => {
  const me = useMe();
  const settings = useSettings();
  const update = useUpdateSettings();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [leaving, setLeaving] = useState(false);
  useScreenView('settings');

  const s = settings.data ?? me.settings;
  const staff = me.role === 'moderator' || me.role === 'admin';
  const patch = (p: Parameters<typeof update.mutate>[0]) => update.mutate(p, { onError: (e) => toast.error(errorMessage(e)) });

  return (
    <SettingsScreen title="Settings">
      <Group label="Account">
        <ListRow
          leading={<RowIcon icon={Mail} />}
          title="Email"
          subtitle={me.email}
          trailing={
            <span className="flex items-center gap-1 type-caption text-ink-3">
              <VerifiedBadge size={14} /> Verified
            </span>
          }
        />
        <ListRow leading={<RowIcon icon={GraduationCap} />} title="University" subtitle={me.university.name} />
        <ListRow leading={<RowIcon icon={UserPen} />} title="Edit profile" subtitle={`@${me.handle}`} to={routes.editProfile()} trailing="chevron" />
        <ListRow
          leading={<RowIcon icon={KeyRound} />}
          title="Password & sign-in"
          subtitle="Optional password, two-step sign-in"
          to={routes.settings('security')}
          trailing="chevron"
        />
      </Group>

      <Group label="Preferences">
        <ListRow leading={<RowIcon icon={Bell} />} title="Notifications" subtitle="Per category, quiet hours" to={routes.settings('notifications')} trailing="chevron" />
        <ListRow leading={<RowIcon icon={Shield} />} title="Privacy & safety" subtitle="Who can message you, blocked users" to={routes.settings('privacy')} trailing="chevron" />
      </Group>

      <Group label="Appearance">
        <ListRow
          leading={<RowIcon icon={Sparkles} />}
          title={<span id="settings-reduce-motion">Reduce motion</span>}
          subtitle="Fewer springs and slides"
          trailing={<Switch checked={s.reduceMotion} onChange={(v) => patch({ reduceMotion: v })} aria-labelledby="settings-reduce-motion" />}
        />
        <ListRow
          leading={<RowIcon icon={Sparkles} />}
          title={<span id="settings-autoplay">Autoplay videos</span>}
          subtitle="Reels play as you scroll"
          trailing={<Switch checked={s.autoplayVideos} onChange={(v) => patch({ autoplayVideos: v })} aria-labelledby="settings-autoplay" />}
        />
      </Group>

      <Group label="Community">
        <ListRow leading={<RowIcon icon={UserPlus} tone="accent" />} title="Invite friends" subtitle="Your personal link" to={routes.settings('invite')} trailing="chevron" />
        <ListRow leading={<RowIcon icon={Scale} />} title="Account status" subtitle={standingLine(me)} to={routes.accountStatus()} trailing="chevron" />
        <ListRow leading={<RowIcon icon={Info} />} title="About" subtitle="Guidelines, Terms, Privacy" to={routes.settings('about')} trailing="chevron" />
        {staff ? <ListRow leading={<RowIcon icon={ShieldCheck} tone="accent" />} title="Trust & Safety" subtitle="Moderation queue" to={routes.admin()} trailing="chevron" /> : null}
      </Group>

      <div className="flex flex-col gap-2">
        <Button
          variant="danger-ghost"
          size="lg"
          fullWidth
          leftIcon={LogOut}
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void logout().finally(() => setLeaving(false));
          }}
        >
          Sign out
        </Button>
        <Button variant="danger-ghost" size="lg" fullWidth leftIcon={Trash2} onClick={() => setConfirmDelete(true)}>
          Delete account
        </Button>
      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={(o) => {
          setConfirmDelete(o);
          if (!o) setTyped('');
        }}
        icon={Trash2}
        tone="danger"
        title="Delete your account?"
        description="Your profile, posts and messages are removed and your handle stays retired. This cannot be undone."
        confirmLabel="Delete account"
        confirmDisabled={typed !== 'DELETE'}
        onConfirm={async () => {
          try {
            await deleteAccount();
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
          toast.info('Your account was deleted.');
          await logout();
        }}
      >
        <Input
          label="Type DELETE to confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="DELETE"
        />
      </Dialog>
    </SettingsScreen>
  );
};

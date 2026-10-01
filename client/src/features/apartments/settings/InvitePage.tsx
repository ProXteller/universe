/**
 * Settings → Invite friends (foundation #16): personal link, copy / native share, "{n} joined from your link".
 */
import type { FC } from 'react';
import { Copy, Share2, UserPlus } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '@/ui';
import { UserRow } from '@/components';
import { track, useScreenView } from '@/lib/analytics';
import { copyLink } from '@/lib/share';
import { useInvite } from '../api';
import { Group, RowsSkeleton, SettingsScreen } from './shared';

export const InvitePage: FC = () => {
  const invite = useInvite();
  useScreenView('settings_invite');
  const stats = invite.data;

  const copy = async () => {
    if (!stats) return;
    track('invite_link_copied');
    await copyLink(stats.url);
  };
  const share = async () => {
    if (!stats) return;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: 'Join me on UniVerse', text: 'Verified students only. Use my link:', url: stats.url });
        track('invite_link_copied', { method: 'native' });
        return;
      } catch {
        /* dismissed */
      }
    }
    await copy();
  };
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  if (invite.isLoading) {
    return (
      <SettingsScreen title="Invite friends">
        <Card className="flex flex-col gap-3" aria-busy="true" aria-label="Loading">
          <Skeleton w="60%" h={14} />
          <Skeleton w="100%" h={44} className="rounded-md" />
          <Skeleton w="100%" h={44} className="rounded-full" />
        </Card>
        <RowsSkeleton rows={3} />
      </SettingsScreen>
    );
  }
  if (invite.isError || !stats) {
    return (
      <SettingsScreen title="Invite friends">
        <ErrorState error={invite.error} onRetry={() => void invite.refetch()} />
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title="Invite friends">
      <Card variant="hero" className="flex flex-col gap-3">
        <div>
          <p className="type-headline text-ink">Your personal link</p>
          <p className="type-footnote text-ink-2">Friends who join through it get you pinned in their first follow suggestions.</p>
        </div>
        <p className="break-all rounded-md border border-line bg-surface-2 px-3 py-2.5 font-mono type-footnote text-ink" aria-label="Invite link">
          {stats.url}
        </p>
        <div className="flex gap-2">
          <Button fullWidth leftIcon={Copy} onClick={() => void copy()}>
            Copy link
          </Button>
          {canNativeShare ? (
            <Button variant="secondary" fullWidth leftIcon={Share2} onClick={() => void share()}>
              Share
            </Button>
          ) : null}
        </div>
      </Card>

      <Group label={`${stats.joinedCount} joined from your link`}>
        {stats.joined.length === 0 ? (
          <EmptyState icon={UserPlus} title="Nobody has joined from your link yet." action={{ label: 'Copy link', onClick: () => void copy() }} compact />
        ) : (
          stats.joined.map((u) => <UserRow key={u.id} user={u} tag="Joined from your link" />)
        )}
      </Group>
    </SettingsScreen>
  );
};

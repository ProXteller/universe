/**
 * Me sheet (SPEC §4.4.3): opened from the Home top-bar Me button. Rows: profile, Campus hub, Saved listings,
 * Settings, Community Guidelines, Trust & Safety (staff only). A public-mode overlay the user opens on purpose.
 */
import { useNavigate } from 'react-router-dom';
import { BookOpen, Bookmark, ChevronRight, School, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { ListRow, Sheet, VerifiedBadge } from '@/ui';
import { UserAvatar } from '@/components';
import { routes } from '@/lib/links';
import { useMeOptional } from '@/lib/session';
import { useUiStore } from '@/stores/ui';

function Disc({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-ink-2">
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

export function MeSheet() {
  const open = useUiStore((s) => s.meSheetOpen);
  const setOpen = useUiStore((s) => s.setMeSheetOpen);
  const me = useMeOptional();
  const navigate = useNavigate();
  if (!me) return null;

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const staff = me.role === 'moderator' || me.role === 'admin';

  return (
    <Sheet open={open} onOpenChange={setOpen} aria-label="Me">
      <button
        type="button"
        onClick={() => go(routes.profile(me.handle))}
        className="press flex w-full items-center gap-3 rounded-lg border border-line bg-surface-1 px-3.5 py-3 text-left"
      >
        <UserAvatar user={me} size="lg" link={false} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span className="truncate type-headline text-ink">{me.displayName}</span>
            {me.isVerified ? <VerifiedBadge size={14} /> : null}
          </span>
          <span className="truncate type-footnote text-ink-3">@{me.handle} · View profile</span>
        </span>
        <ChevronRight size={18} strokeWidth={2} aria-hidden className="shrink-0 text-ink-4" />
      </button>

      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-1">
        <ListRow leading={<Disc icon={School} />} title="Campus hub" subtitle={me.university.name} trailing="chevron" onClick={() => go(routes.campus())} />
        <ListRow leading={<Disc icon={Bookmark} />} title="Saved listings" trailing="chevron" onClick={() => go(routes.marketSaved())} />
        <ListRow leading={<Disc icon={Settings} />} title="Settings" trailing="chevron" onClick={() => go(routes.settings())} />
        <ListRow leading={<Disc icon={BookOpen} />} title="Community Guidelines" trailing="chevron" onClick={() => go(routes.guidelines())} />
        {staff ? (
          <ListRow leading={<Disc icon={ShieldCheck} />} title="Trust & Safety" subtitle="Moderation queue, reports, audit log" trailing="chevron" onClick={() => go(routes.admin())} />
        ) : null}
      </div>
    </Sheet>
  );
}

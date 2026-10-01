/**
 * Post body text: line breaks kept, @handles linkified to profiles, in-app links (`/market/:id`,
 * `/campus/events/:id`, `/reel/:id`, `/post/:id`, `/u/:handle`) turned into compact live cards under the text
 * (`GET /cards/:kind/:id`; profile links render a `UserRow`). Optional 6-line clamp with an in-place "more".
 */
import { useMemo, useState, type FC, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PublicUser, ShareCardKind } from '@shared/core';
import { Skeleton } from '@/ui';
import { ShareCardView, UserRow } from '@/components';
import { cn } from '@/lib/cn';
import { api } from '@/lib/api';
import { routes } from '@/lib/links';
import { queryClient } from '@/lib/query';
import { useLinkCard } from './api';

type LinkRef = { kind: ShareCardKind; id: string } | { kind: 'profile-handle'; handle: string };

const INTERNAL_LINK =
  /(?:https?:\/\/[^\s/]+)?\/(market|campus\/events|reel|post|u)\/([A-Za-z0-9_-]{1,64})(?=[\s.,;:!?)]|$)/g;
const HANDLE = /(^|[^A-Za-z0-9_/])@([A-Za-z0-9_]{3,20})\b/g;

const KIND_BY_PATH: Record<string, ShareCardKind> = { market: 'listing', 'campus/events': 'event', reel: 'reel', post: 'post' };

/** Distinct internal references in the text, in order of appearance (max 3 cards per post). */
export function extractLinks(text: string): LinkRef[] {
  const out: LinkRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(INTERNAL_LINK)) {
    const path = m[1]!;
    const id = m[2]!;
    const ref: LinkRef = path === 'u' ? { kind: 'profile-handle', handle: id } : { kind: KIND_BY_PATH[path]!, id };
    const key = ref.kind === 'profile-handle' ? `u:${ref.handle.toLowerCase()}` : `${ref.kind}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= 3) break;
  }
  return out;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let key = 0;
  const lines = text.split('\n');
  lines.forEach((line, li) => {
    let last = 0;
    for (const m of line.matchAll(HANDLE)) {
      const start = (m.index ?? 0) + m[1]!.length;
      if (start > last) nodes.push(line.slice(last, start));
      const handle = m[2]!;
      nodes.push(
        <Link key={`h${key++}`} to={routes.profile(handle)} className="text-accent-ink" onClick={(e) => e.stopPropagation()}>
          @{handle}
        </Link>,
      );
      last = start + handle.length + 1;
    }
    if (last < line.length) nodes.push(line.slice(last));
    if (li < lines.length - 1) nodes.push(<br key={`b${key++}`} />);
  });
  return nodes;
}

export interface PostTextProps {
  text: string;
  /** Clamp to 6 lines with an in-place "more" (feed); detail passes `false`. */
  clamp?: boolean;
  size?: 'body' | 'body-lg';
  /** Render the link cards under the text (default true). */
  cards?: boolean;
  className?: string;
}

export const PostText: FC<PostTextProps> = ({ text, clamp = true, size = 'body', cards = true, className }) => {
  const [expanded, setExpanded] = useState(false);
  const links = useMemo(() => (cards ? extractLinks(text) : []), [text, cards]);
  const long = clamp && !expanded && (text.length > 360 || text.split('\n').length > 6);
  if (!text.trim() && links.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {text.trim() ? (
        <p className={cn('whitespace-pre-wrap break-words text-ink', size === 'body-lg' ? 'type-body-lg' : 'type-body', long && 'line-clamp-6')}>
          {renderInline(text)}
        </p>
      ) : null}
      {long ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
          className="-my-2 inline-flex min-h-11 items-center self-start type-label-sm text-ink-3 hover:text-ink"
        >
          more
        </button>
      ) : null}
      {links.map((l) => (l.kind === 'profile-handle' ? <ProfileLinkCard key={`u:${l.handle}`} handle={l.handle} /> : <LinkCard key={`${l.kind}:${l.id}`} kind={l.kind} id={l.id} />))}
    </div>
  );
};

const LinkCard: FC<{ kind: ShareCardKind; id: string }> = ({ kind, id }) => {
  const q = useLinkCard(kind, id);
  if (q.isLoading) return <Skeleton h={56} className="w-full rounded-lg" />;
  if (!q.data || q.data.status === 'unavailable') return null; // R6: a missing provider renders nothing
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <ShareCardView card={q.data} variant="compact" />
    </div>
  );
};

const ProfileLinkCard: FC<{ handle: string }> = ({ handle }) => {
  const q = useQuery<PublicUser>({
    queryKey: ['users', 'handle', handle.toLowerCase()],
    queryFn: async ({ signal }) => {
      const u = await api.get<PublicUser>(`/users/${encodeURIComponent(handle)}`, undefined, { signal });
      queryClient.setQueryData(['users', u.id], u);
      return u;
    },
    staleTime: 60_000,
    retry: false,
  });
  if (q.isLoading) return <Skeleton h={64} className="w-full rounded-lg" />;
  if (!q.data || q.data.viewer.isBlockedByMe) return null;
  return (
    <div className="rounded-lg border border-line bg-surface-1" onClick={(e) => e.stopPropagation()}>
      <UserRow user={q.data} trailing={q.data.viewer.isSelf ? 'none' : 'follow'} />
    </div>
  );
};

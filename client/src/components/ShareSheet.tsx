/**
 * ShareSheet + host (SPEC §4.4.1 `openShare`): recent chats row → `POST /share`, Copy link, native share when
 * `navigator.share` exists. The card preview is resolved live through `GET /cards/:kind/:id`.
 */
import { forwardRef, useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Link2, Send, Share } from 'lucide-react';
import type { ConversationSummary, Paginated, ShareCard, ShareCardRef, ShareRequest, ShareResponse } from '@shared/core';
import { ANON_ENTITY_TYPES } from '@shared/core';
import { Avatar, AvatarStack, Button, Sheet, Skeleton, Surface } from '@/ui';
import { cn } from '@/lib/cn';
import { api, errorMessage } from '@/lib/api';
import { track } from '@/lib/analytics';
import { absoluteUrl, copyLink, type OpenShareInput } from '@/lib/share';
import { toast } from '@/lib/toast';
import { useSessionStore } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { ShareCardView } from './ShareCardView';

export interface ShareSheetProps extends OpenShareInput {
  open: boolean;
  onOpenChange(open: boolean): void;
  className?: string;
}

const MAX_TARGETS = 10;

const isAnonCard = (card: ShareCardRef): boolean => (ANON_ENTITY_TYPES as readonly string[]).includes(card.kind);

/** `share_click` props: an anonymous (Buzz) card never names its id next to the viewer (SPEC §3.2 #8). */
function shareProps(card: ShareCardRef, method: 'sheet' | 'copy' | 'native'): Record<string, string> {
  return isAnonCard(card) ? { kind: card.kind, method } : { kind: card.kind, id: card.id, method };
}

function TargetBubble({ c, selected, onToggle, viewerId }: { c: ConversationSummary; selected: boolean; onToggle(): void; viewerId: string | null }) {
  // never the viewer's own face / name (a chat they are alone in); the server already leaves them out
  const preview = c.memberPreview.filter((u) => u.id !== viewerId);
  const stack = c.kind !== 'dm' && !c.avatarUrl && preview.length > 0;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className="press flex w-[72px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-md py-1"
    >
      <span className="relative">
        {stack ? (
          <AvatarStack users={preview.map((u) => ({ src: u.avatarUrl, name: u.displayName, shape: u.accountType === 'org' ? 'org' : 'circle' }))} max={2} size="md" />
        ) : (
          <Avatar src={c.avatarUrl} name={c.title} size="lg" shape={c.peer?.accountType === 'org' ? 'org' : 'circle'} />
        )}
        <span
          aria-hidden
          className={cn(
            'absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full ring-2 ring-surface-2 transition-opacity duration-150',
            selected ? 'bg-accent text-on-accent opacity-100' : 'opacity-0',
          )}
        >
          <Check size={12} strokeWidth={3} />
        </span>
      </span>
      <span className={cn('w-full truncate text-center type-caption', selected ? 'text-ink' : 'text-ink-2')}>{c.title}</span>
    </button>
  );
}

export const ShareSheet = forwardRef<HTMLDivElement, ShareSheetProps>(function ShareSheet(
  { open, onOpenChange, card, url, title, text, mode, className },
  ref,
) {
  const [selected, setSelected] = useState<string[]>([]);
  const viewerId = useSessionStore((s) => s.me?.id ?? null);
  useEffect(() => {
    if (open) setSelected([]);
  }, [open, card.kind, card.id]);

  const targets = useQuery<Paginated<ConversationSummary>>({
    queryKey: ['share', 'targets'],
    queryFn: () => api.get<Paginated<ConversationSummary>>('/share/targets'),
    enabled: open,
    staleTime: 15_000,
  });
  const preview = useQuery<ShareCard>({
    queryKey: ['cards', card.kind, card.id],
    queryFn: () => api.get<ShareCard>(`/cards/${encodeURIComponent(card.kind)}/${encodeURIComponent(card.id)}`),
    enabled: open,
  });

  const send = useMutation<ShareResponse, unknown, ShareRequest>({
    mutationFn: (body) => api.post<ShareResponse>('/share', body),
    onSuccess: (res) => {
      if (res.sent > 0) toast.success(res.sent === 1 ? 'Sent' : `Sent to ${res.sent} chats`);
      if (res.failedConversationIds.length > 0) toast.error(`Couldn't send to ${res.failedConversationIds.length} chat${res.failedConversationIds.length === 1 ? '' : 's'}.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_TARGETS) {
        toast.info(`Up to ${MAX_TARGETS} chats at a time.`);
        return prev;
      }
      return [...prev, id];
    });

  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const doNative = async () => {
    track('share_click', shareProps(card, 'native'));
    try {
      await navigator.share({ title, text, url: absoluteUrl(url) });
      onOpenChange(false);
    } catch {
      /* the user dismissed the OS sheet */
    }
  };
  const doCopy = async () => {
    track('share_click', shareProps(card, 'copy'));
    await copyLink(url);
    onOpenChange(false);
  };

  const list = targets.data?.items ?? [];

  return (
    <Sheet
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      title="Share"
      className={className}
      footer={
        selected.length > 0 ? (
          <Button
            size="lg"
            fullWidth
            leftIcon={Send}
            loading={send.isPending}
            // no caption: `text` is for navigator.share only — forwarding it would copy the post (for Buzz: anonymous,
            // possibly later removed) into a message under the sharer's name
            onClick={() => send.mutate({ card, conversationIds: selected })}
          >
            Send to {selected.length} {selected.length === 1 ? 'chat' : 'chats'}
          </Button>
        ) : undefined
      }
    >
      <div className="mb-4">
        {preview.data ? (
          <ShareCardView card={preview.data} variant="compact" onClick={() => undefined} />
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-1 px-2.5 py-2">
            <Skeleton w={44} h={44} className="rounded-sm" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton w="60%" h={12} />
              <Skeleton w="40%" h={10} />
            </div>
          </div>
        )}
      </div>

      {mode === 'incognito' ? (
        <p className="mb-3 px-1 type-footnote text-ink-2">Shares the post only. Your chat will see it came from you.</p>
      ) : null}
      <p className="mb-1.5 px-1 type-overline text-ink-3">Send in a chat</p>
      {targets.isLoading ? (
        <div className="flex gap-2 py-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex w-[72px] flex-col items-center gap-1.5 py-1">
              <Skeleton circle w={56} h={56} />
              <Skeleton w={44} h={10} />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="rounded-lg border border-line bg-surface-1 px-3.5 py-3 type-footnote text-ink-3">
          {targets.isError ? "Couldn't load your chats." : 'Start a chat and it will show up here.'}
        </p>
      ) : (
        <div className="scroll-x -mx-4 flex snap-x gap-1 px-4 py-1" data-sheet-no-drag>
          {list.map((c) => (
            <TargetBubble key={c.id} c={c} viewerId={viewerId} selected={selected.includes(c.id)} onToggle={() => toggle(c.id)} />
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="lg" fullWidth leftIcon={Link2} onClick={() => void doCopy()}>
          Copy link
        </Button>
        {canNative ? (
          <Button variant="secondary" size="lg" fullWidth leftIcon={Share} onClick={() => void doNative()}>
            Share…
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
});

/** Mounted once by AppShell. */
export function ShareHost() {
  const request = useUiStore((s) => s.share);
  const closeShare = useUiStore((s) => s.closeShare);
  const [last, setLast] = useState(request);
  useEffect(() => {
    if (request) {
      setLast(request);
      track('share_click', shareProps(request.card, 'sheet'));
    }
  }, [request]);
  const current = request ?? last;
  if (!current) return null;
  const sheet = <ShareSheet open={request !== null} onOpenChange={(o) => (o ? undefined : closeShare())} {...current} />;
  // re-stamp the caller's surface (Buzz → incognito chrome), as ReportHost does
  return current.mode ? (
    <Surface mode={current.mode} style={{ display: 'contents', backgroundColor: 'transparent' }}>
      {sheet}
    </Surface>
  ) : (
    sheet
  );
}

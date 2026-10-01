/**
 * ModerationHost (SPEC §4.4.2): the 422 `content_blocked` sheet ([Edit] [Read the guidelines] + [Get help
 * reporting] for M-NAMED) and the self-harm support sheet (safety §2.10 S-HEAD / S-BODY). Driven by
 * `lib/moderation.ts` through `stores/ui.ts`.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, HeartHandshake, LifeBuoy, PenLine, ShieldAlert } from 'lucide-react';
import type { ContentBlockedDetails, SupportResources } from '@shared/core';
import { Button, Sheet, Surface } from '@/ui';
import { routes } from '@/lib/links';
import { useUiStore, type ModerationOverlay } from '@/stores/ui';

function BlockedSheet({
  open,
  onOpenChange,
  details,
  body,
  onEdit,
}: {
  open: boolean;
  onOpenChange(o: boolean): void;
  details: ContentBlockedDetails;
  body: string;
  onEdit?: () => void;
}) {
  const navigate = useNavigate();
  const named = details.messageId === 'M-NAMED';
  return (
    <Sheet open={open} onOpenChange={onOpenChange} aria-label={details.title}>
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warning-soft text-warning">
          <ShieldAlert size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="type-title-2 text-ink">{details.title}</h2>
        {body ? <p className="type-body text-ink-2">{body}</p> : null}
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Button
          size="lg"
          fullWidth
          leftIcon={PenLine}
          onClick={() => {
            onOpenChange(false);
            onEdit?.();
          }}
        >
          Edit
        </Button>
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          leftIcon={BookOpen}
          onClick={() => {
            onOpenChange(false);
            navigate(routes.guidelines(details.guidelineAnchor ?? undefined));
          }}
        >
          Read the guidelines
        </Button>
        {named ? (
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            leftIcon={LifeBuoy}
            onClick={() => {
              onOpenChange(false);
              navigate(routes.guidelines('enforcement'));
            }}
          >
            Get help reporting
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

function SupportSheet({ open, onOpenChange, support }: { open: boolean; onOpenChange(o: boolean): void; support: SupportResources }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (open) setMore(false);
  }, [open]);
  const first = support.lines[0];
  const rest = support.lines.slice(1);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} aria-label={support.headline}>
      <div className="flex flex-col items-center gap-3 pb-1 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-info-soft text-info">
          <HeartHandshake size={26} strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="type-title-2 text-ink">{support.headline}</h2>
        <p className="type-body text-ink-2">{support.body}</p>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {first ? (
          <Button size="lg" fullWidth onClick={() => window.open(first.href, '_blank', 'noopener')}>
            {first.label}
          </Button>
        ) : null}
        {rest.length > 0 && !more ? (
          <Button variant="secondary" size="lg" fullWidth onClick={() => setMore(true)}>
            More options
          </Button>
        ) : null}
        {more
          ? rest.map((line) => (
              <Button key={line.href} variant="secondary" size="lg" fullWidth onClick={() => window.open(line.href, '_blank', 'noopener')}>
                {line.label} · {line.detail}
              </Button>
            ))
          : null}
        <Button variant="ghost" size="lg" fullWidth onClick={() => onOpenChange(false)}>
          I'm OK, thanks
        </Button>
        <p className="pt-1 text-center type-caption text-ink-3">{support.emergencyNote}</p>
      </div>
    </Sheet>
  );
}

/**
 * Mounted once by AppShell (outside every Surface). Renders the sheet inside the caller's surface mode captured
 * by `lib/moderation` at call time, as ReportHost / ShareHost do — a block from Buzz stays Phosphor.
 */
export function ModerationHost() {
  const overlay = useUiStore((s) => s.moderation);
  const close = useUiStore((s) => s.closeModeration);
  const [last, setLast] = useState<ModerationOverlay | null>(overlay);
  useEffect(() => {
    if (overlay) setLast(overlay);
  }, [overlay]);
  const current = overlay ?? last;
  if (!current) return null;
  const open = overlay !== null;
  const onOpenChange = (o: boolean) => {
    if (o) return;
    if (current.kind === 'blocked' && current.details.support) {
      // The block sheet is followed by the support sheet (M-NAMED / S-METHOD carry resources), same surface.
      useUiStore.getState().openModeration({ kind: 'support', support: current.details.support, mode: current.mode });
      return;
    }
    close();
  };
  const sheet =
    current.kind === 'blocked' ? (
      <BlockedSheet open={open} onOpenChange={onOpenChange} details={current.details} body={current.body} onEdit={current.onEdit} />
    ) : (
      <SupportSheet open={open} onOpenChange={onOpenChange} support={current.support} />
    );
  // Keyed by mode: a sheet reopened from the other world mounts fresh instead of cross-fading its accent.
  return current.mode ? (
    <Surface key={current.mode} mode={current.mode} style={{ display: 'contents', backgroundColor: 'transparent' }}>
      {sheet}
    </Surface>
  ) : (
    sheet
  );
}

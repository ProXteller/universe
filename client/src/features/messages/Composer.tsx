/**
 * Chat composer (design §7.4): glass footer with attach, an auto-growing bare Textarea (1–5 rows) and an accent send
 * button that appears when there is something to send. `ComposerModeBanner` (inline, "Messaging as @handle") is
 * mandatory on every create surface (SPEC §5 common rules). Quick replies come from the pinned context.
 */
import { useEffect, useRef, useState, type FC, type KeyboardEvent } from 'react';
import { CornerUpLeft, ImagePlus, Send, X } from 'lucide-react';
import type { ContextCard, MediaImage, SendMessageRequest } from '@shared/core';
import { LIMITS } from '@shared/core';
import { QUICK_REPLIES } from '@shared/messages';
import { Chip, IconButton, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaPicker } from '@/components';
import { cn } from '@/lib/cn';
import { firstName, formatPrice } from '@/lib/format';
import { useMediaQuery } from '@/lib/hooks';
import type { LocalMessage } from './api';

export interface ComposerProps {
  /** Initial text (location.state.draft) — applied once. */
  draft?: string | null;
  context: ContextCard | null;
  replyTo: LocalMessage | null;
  onCancelReply(): void;
  /** Wrap in ComposerGuard (pending request to a stranger → public posting rules apply). */
  guard: boolean;
  disabled?: boolean;
  onSend(body: SendMessageRequest): Promise<boolean>;
  onTyping(isTyping: boolean): void;
  /** Composer text set from outside (block sheet "Edit"). */
  restoreText?: string | null;
}

/** Templates with `{price10}` / `{meetupSpot}` are dropped when the card has no value for them. */
function quickReplies(context: ContextCard | null): string[] {
  if (!context) return [];
  if (context.kind !== 'listing') return QUICK_REPLIES.roommate;
  const price10 = context.price !== null && context.price > 0 ? formatPrice(Math.max(1, Math.round(context.price * 0.9)), context.currency) : null;
  const out: string[] = [];
  for (const t of QUICK_REPLIES.listing) {
    if (t.includes('{price10}')) {
      if (price10) out.push(t.replace('{price10}', price10));
    } else if (t.includes('{meetupSpot}')) {
      if (context.meetupSpot) out.push(t.replace('{meetupSpot}', context.meetupSpot));
    } else out.push(t);
  }
  return out;
}

export const Composer: FC<ComposerProps> = ({ draft, context, replyTo, onCancelReply, guard, disabled = false, onSend, onTyping, restoreText }) => {
  const [text, setText] = useState(draft ?? '');
  const [images, setImages] = useState<MediaImage[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const typingOn = useRef(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const enterSends = useMediaQuery('(hover: hover) and (pointer: fine)');

  useEffect(() => {
    if (restoreText) {
      setText(restoreText);
      areaRef.current?.focus();
    }
  }, [restoreText]);

  useEffect(() => {
    if (replyTo) areaRef.current?.focus();
  }, [replyTo]);

  const stopTyping = () => {
    if (typingTimer.current !== null) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (typingOn.current) {
      typingOn.current = false;
      onTyping(false);
    }
  };
  useEffect(() => stopTyping, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (v: string) => {
    setText(v);
    if (v.trim()) {
      if (!typingOn.current) {
        typingOn.current = true;
        onTyping(true);
      }
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      typingTimer.current = window.setTimeout(stopTyping, 3000);
    } else stopTyping();
  };

  const canSend = !disabled && !sending && !uploading && (text.trim().length > 0 || images.length > 0);

  const submit = async () => {
    if (!canSend) return;
    const body: SendMessageRequest = images.length > 0 ? { kind: 'image', images, text: text.trim() || undefined } : { kind: 'text', text: text.trim() };
    if (replyTo) body.replyToId = replyTo.id;
    setSending(true);
    stopTyping();
    const ok = await onSend(body);
    setSending(false);
    if (ok) {
      setText('');
      setImages([]);
      setShowPicker(false);
      onCancelReply();
      areaRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && (enterSends || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  const chips = text.trim() || images.length > 0 ? [] : quickReplies(context);

  const inner = (
    <div className="flex flex-col gap-2 px-3 pt-2 pb-2">
      {chips.length > 0 ? (
        <div className="scroll-x -mx-3 flex gap-2 px-3" role="group" aria-label="Quick replies">
          {chips.map((c) => (
            <Chip key={c} variant="choice" size="sm" onClick={() => onChange(c)} className="shrink-0">
              {c}
            </Chip>
          ))}
        </div>
      ) : null}
      {replyTo ? (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-accent bg-surface-2 py-1.5 pr-1 pl-2.5">
          <CornerUpLeft size={14} strokeWidth={2} aria-hidden className="shrink-0 text-accent-ink" />
          <span className="min-w-0 flex-1 truncate type-caption text-ink-2">
            Replying to {replyTo.sender ? firstName(replyTo.sender.displayName) : 'message'}: {replyTo.text || (replyTo.kind === 'image' ? 'Photo' : replyTo.kind)}
          </span>
          <IconButton icon={X} aria-label="Cancel reply" size="sm" onClick={onCancelReply} />
        </div>
      ) : null}
      {showPicker || images.length > 0 ? (
        <MediaPicker value={images} onChange={setImages} max={LIMITS.messageImages} variant="tray" onUploadingChange={setUploading} disabled={disabled} />
      ) : null}
      <ComposerModeBanner mode="public" verb="Messaging" size="inline" />
      <div className="flex items-end gap-1.5">
        <IconButton
          icon={ImagePlus}
          aria-label={showPicker ? 'Hide photo picker' : 'Attach photos'}
          active={showPicker}
          disabled={disabled}
          onClick={() => setShowPicker((v) => !v)}
          className="mb-0.5"
        />
        <div className={cn('min-w-0 flex-1 rounded-[22px] border border-line bg-surface-1 px-3.5 py-1.5', disabled && 'opacity-60')}>
          <Textarea
            ref={areaRef}
            variant="bare"
            aria-label="Message"
            placeholder={disabled ? "You can't send messages here" : 'Message…'}
            minRows={1}
            maxRows={5}
            maxLength={LIMITS.messageText}
            showCount={text.length > LIMITS.messageText - 200}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            enterKeyHint="send"
          />
        </div>
        <IconButton
          icon={Send}
          aria-label="Send"
          variant="accent"
          disabled={!canSend}
          onClick={() => void submit()}
          className={cn('mb-0.5 transition-opacity duration-150', canSend ? 'opacity-100' : 'opacity-40')}
        />
      </div>
    </div>
  );

  return <div className="glass">{guard ? <ComposerGuard className="m-3">{inner}</ComposerGuard> : inner}</div>;
};

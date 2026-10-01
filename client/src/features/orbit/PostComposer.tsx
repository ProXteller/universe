/**
 * Post composer (design §7.2): `full` Sheet with the public `ComposerModeBanner` ("Posting as @handle · Visible on
 * your public profile"), bare Textarea (≤ 1000, counter), `MediaPicker max=4`, poll builder (2–4 options), CTA "Post".
 * No audience Select (SPEC §2.3). Wrapped in `ComposerGuard`. Draft lives in the orbit store.
 */
import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BarChart3, Plus, X } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { Post } from '@shared/orbit';
import { Button, IconButton, Input, Sheet, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaPicker } from '@/components';
import { errorMessage, isApiError } from '@/lib/api';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { prependInfiniteItem } from '@/lib/query';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { createPostRequest, orbitKeys, seedPostDetail } from './api';
import { draftIsEmpty, useOrbitStore } from './store';

export interface PostComposerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called with the created post (already prepended to the feed + own list). */
  onPosted?(post: Post): void;
}

export const PostComposer: FC<PostComposerProps> = ({ open, onOpenChange, onPosted }) => {
  const me = useMe();
  const draft = useOrbitStore((s) => s.draft);
  const setDraft = useOrbitStore((s) => s.setDraft);
  const clearDraft = useOrbitStore((s) => s.clearDraft);
  const [uploading, setUploading] = useState(false);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => textRef.current?.focus(), 250);
    return () => window.clearTimeout(t);
  }, [open]);

  const poll = draft.poll;
  const pollValid = poll === null || (poll.filter((o) => o.trim()).length >= LIMITS.pollMinOptions && poll.every((o) => o.trim().length <= LIMITS.pollOptionText));
  const canPost = !draftIsEmpty(draft) && pollValid && !uploading && draft.text.length <= LIMITS.postText;

  const create = useMutation({
    mutationFn: () =>
      createPostRequest({
        text: draft.text.trim(),
        images: draft.images.length ? draft.images : undefined,
        poll: poll ? { options: poll.map((o) => o.trim()).filter(Boolean) } : undefined,
      }),
    onSuccess: (res) => {
      const { moderation, ...post } = res;
      prependInfiniteItem<Post>([...orbitKeys.feed], post);
      prependInfiniteItem<Post>([...orbitKeys.userPosts(me.id)], post);
      seedPostDetail(post);
      clearDraft();
      onOpenChange(false);
      showModerationNotice(moderation);
      if (moderation.status !== 'held') toast.success('Posted to your Orbit');
      onPosted?.(post);
    },
    onError: (e) => {
      if (handleModerationError(e, { onEdit: () => textRef.current?.focus() })) return;
      if (isApiError(e) && e.status === 403 && (e.details as { reason?: string } | undefined)?.reason === 'account_too_new') {
        toast.info(e.message);
        return;
      }
      toast.error(errorMessage(e));
    },
  });

  const setImages = useCallback((v: MediaImage[]) => setDraft({ images: v }), [setDraft]);

  const setOption = (i: number, v: string) => {
    if (!poll) return;
    const next = [...poll];
    next[i] = v;
    setDraft({ poll: next });
  };
  const removeOption = (i: number) => {
    if (!poll) return;
    const next = poll.filter((_, k) => k !== i);
    setDraft({ poll: next.length >= 2 ? next : null });
  };

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 truncate type-caption text-ink-3">{uploading ? 'Uploading photos…' : draft.images.length ? `${draft.images.length} of ${LIMITS.postImages} photos` : poll ? 'Poll · one vote per person' : 'Text, photos or a poll'}</span>
      <Button variant="hero" size="md" loading={create.isPending} disabled={!canPost} onClick={() => create.mutate()}>
        Post
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="New post" detents={['full']} footer={footer} dismissible={!create.isPending}>
      <ComposerGuard scope="public">
        <div className="flex flex-col gap-4 px-4 pb-4">
          <ComposerModeBanner mode="public" verb="Posting" note="Visible on your public profile" />
          <Textarea
            ref={textRef}
            variant="bare"
            aria-label="Post text"
            placeholder="What's happening on campus?"
            minRows={4}
            maxRows={14}
            maxLength={LIMITS.postText}
            showCount
            value={draft.text}
            onChange={(e) => setDraft({ text: e.target.value })}
            disabled={create.isPending}
            className="type-body-lg"
          />
          <MediaPicker value={draft.images} onChange={setImages} max={LIMITS.postImages} variant="tray" disabled={create.isPending} onUploadingChange={setUploading} hint="Up to 4 photos" />
          {poll ? (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3" role="group" aria-label="Poll options">
              <div className="flex items-center justify-between">
                <span className="type-label-sm text-ink-2">Poll</span>
                <Button variant="ghost" size="sm" leftIcon={X} onClick={() => setDraft({ poll: null })}>
                  Remove poll
                </Button>
              </div>
              {poll.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label={`Option ${i + 1}`}
                    placeholder={`Option ${i + 1}`}
                    value={o}
                    maxLength={LIMITS.pollOptionText}
                    onChange={(e) => setOption(i, e.target.value)}
                    className="flex-1"
                  />
                  {poll.length > LIMITS.pollMinOptions ? <IconButton icon={X} aria-label={`Remove option ${i + 1}`} variant="ghost" size="sm" onClick={() => removeOption(i)} /> : null}
                </div>
              ))}
              {poll.length < LIMITS.pollMaxOptions ? (
                <Button variant="ghost" size="sm" leftIcon={Plus} onClick={() => setDraft({ poll: [...poll, ''] })} className="self-start">
                  Add option
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" leftIcon={BarChart3} onClick={() => setDraft({ poll: ['', ''] })} disabled={create.isPending}>
                Add a poll
              </Button>
            </div>
          )}
        </div>
      </ComposerGuard>
    </Sheet>
  );
};

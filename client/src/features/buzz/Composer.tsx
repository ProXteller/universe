/**
 * Buzz composer (design §7.2): a `full` Sheet inside the incognito Surface with the mandatory
 * `ComposerModeBanner mode="incognito"`, a Campus / Global choice, an optional title (100), bare Textarea (500),
 * up to 4 photos OR one video (≤ 60 s), poll builder (2–4 options, 1 / 3 / 7 days) and a hero "Buzz it" CTA.
 * No avatar, no handle. Photos are re-encoded without EXIF before upload and rebuilt without metadata by the server;
 * videos are scrubbed of location / device / time metadata when the buzz is posted. Drafts live in the zustand store
 * (wiped on logout, never localStorage).
 */
import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { BarChart3, Clapperboard, Globe, Plus, School, Sparkles, X } from 'lucide-react';
import type { FeedScope, MediaImage } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { BuzzPollDuration } from '@shared/buzz';
import { BUZZ_POLL_DURATIONS } from '@shared/buzz';
import { Button, Chip, ChipGroup, IconButton, Input, ProgressBar, SegmentedControl, Sheet, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner, MediaPicker } from '@/components';
import { errorMessage } from '@/lib/api';
import { readVideoMeta, uploadVideo } from '@/lib/upload';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useBuzzMeta, useCreateBuzz } from './api';
import { useBuzzStore } from './store';

const HOUR = 3_600_000;
const SMALL_CAMPUS_NOTE = 'Small campus: be mindful that details can identify you.';
const DEFAULT_NOTE = "Other students can't see who you are. Community Guidelines still apply.";
const VIDEO_MAX_MS = 60_000;
const VIDEO_TYPES = 'video/mp4,video/quicktime';
const SCOPES: { value: FeedScope; label: string; icon: typeof School }[] = [
  { value: 'campus', label: 'Campus', icon: School },
  { value: 'global', label: 'Global', icon: Globe },
];

export const BuzzComposer: FC = () => {
  const me = useMe();
  const open = useBuzzStore((s) => s.composerOpen);
  const draft = useBuzzStore((s) => s.draft);
  const scope = useBuzzStore((s) => s.scope);
  const { closeComposer, setDraft, clearDraft } = useBuzzStore.getState();
  const meta = useBuzzMeta(scope);
  const create = useCreateBuzz();
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);
  const videoInput = useRef<HTMLInputElement | null>(null);
  const [photosBusy, setPhotosBusy] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => titleRef.current?.focus(), 60);
  }, [open]);

  const canPoll = Date.now() - me.createdAt >= 24 * HOUR;
  const text = draft.text.trim();
  const title = draft.title.trim();
  const options = draft.options.map((o) => o.trim());
  const pollValid = !draft.pollOn || (options.filter(Boolean).length >= LIMITS.pollMinOptions && options.filter(Boolean).length === options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length);
  const uploading = photosBusy || videoProgress !== null;
  const canSubmit = (text.length > 0 || title.length > 0) && text.length <= LIMITS.buzzText && title.length <= LIMITS.buzzTitle && pollValid && !uploading && !create.isPending;
  const setImages = useCallback((images: MediaImage[]) => setDraft({ images }), [setDraft]);

  const pickVideo = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    try {
      const meta = await readVideoMeta(file);
      if (meta.durationMs > VIDEO_MAX_MS + 500) {
        toast.error('Videos on Buzz max out at 60 seconds.');
        return;
      }
      setVideoProgress(0);
      const res = await uploadVideo(file, { durationMs: meta.durationMs, width: meta.width, height: meta.height }, setVideoProgress);
      setDraft({ video: { url: res.url, width: res.width, height: res.height, durationMs: res.durationMs }, images: [] });
    } catch (e) {
      toast.error(e instanceof Error && !('status' in e) ? e.message : errorMessage(e));
    } finally {
      setVideoProgress(null);
    }
  };
  const prompt = draft.promptId && meta.data?.prompt?.id === draft.promptId ? meta.data.prompt : null;

  const submit = (): void => {
    if (!canSubmit) return;
    create.mutate(
      {
        text,
        scope: draft.scope,
        ...(title ? { title } : {}),
        ...(draft.video ? { video: draft.video.url } : draft.images.length ? { images: draft.images.map((i) => i.url) } : {}),
        ...(draft.pollOn ? { poll: { options, durationDays: draft.durationDays } } : {}),
        ...(draft.promptId ? { promptId: draft.promptId } : {}),
      },
      {
        onSuccess: (res) => {
          showModerationNotice(res.moderation);
          if (res.moderation.status !== 'held') {
            toast.success(`Buzzed to ${res.scope === 'global' ? 'Global' : 'your campus'}. Your alias in this thread is ${res.alias.label}.`);
          }
          // show the feed the buzz went to, so it's right there
          if (useBuzzStore.getState().scope !== res.scope) useBuzzStore.getState().setScope(res.scope);
          clearDraft();
          closeComposer();
        },
        onError: (e) => {
          if (!handleModerationError(e, { onEdit: () => textRef.current?.focus() })) toast.error(errorMessage(e));
        },
      },
    );
  };

  const setOption = (i: number, v: string): void => setDraft({ options: draft.options.map((o, k) => (k === i ? v : o)) });
  const addOption = (): void => {
    if (draft.options.length < LIMITS.pollMaxOptions) setDraft({ options: [...draft.options, ''] });
  };
  const removeOption = (i: number): void => {
    if (draft.options.length > LIMITS.pollMinOptions) setDraft({ options: draft.options.filter((_, k) => k !== i) });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) closeComposer();
      }}
      title="New buzz"
      detents={['full']}
      footer={
        <ComposerGuard scope="buzz">
          <div className="flex items-center gap-2">
            <Chip
              variant="filter"
              size="md"
              selected={draft.pollOn}
              leftIcon={BarChart3}
              disabled={!canPoll}
              onClick={() => setDraft({ pollOn: !draft.pollOn })}
            >
              Poll
            </Chip>
            <Chip
              variant="filter"
              size="md"
              selected={draft.video !== null}
              leftIcon={Clapperboard}
              disabled={videoProgress !== null || create.isPending}
              onClick={() => (draft.video ? setDraft({ video: null }) : videoInput.current?.click())}
            >
              Video
            </Chip>
            <span className="min-w-0 flex-1 truncate type-caption text-ink-3">
              {uploading ? 'Uploading…' : !canPoll ? 'Polls unlock after 24 hours' : ''}
            </span>
            <Button variant="hero" size="md" disabled={!canSubmit} loading={create.isPending} onClick={submit}>
              Buzz it
            </Button>
          </div>
        </ComposerGuard>
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
        <ComposerModeBanner mode="incognito" note={meta.data?.smallCampusNote ? SMALL_CAMPUS_NOTE : DEFAULT_NOTE} />
        {prompt ? (
          <div className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2">
            <Sparkles size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-accent-ink" />
            <span className="min-w-0 flex-1 truncate type-footnote text-ink-2">Answering today's prompt: {prompt.text}</span>
            <IconButton icon={X} aria-label="Detach prompt" size="sm" onClick={() => setDraft({ promptId: null })} />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <SegmentedControl<FeedScope>
            aria-label="Post to"
            size="sm"
            value={draft.scope}
            onChange={(v) => setDraft({ scope: v })}
            options={SCOPES.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))}
          />
          <span className="type-caption text-ink-3">
            {draft.scope === 'campus' ? `Only shows in the ${me.university.shortName} campus feed.` : 'Only shows in the Global feed, for students at every campus.'}
          </span>
        </div>
        <Textarea
          ref={titleRef}
          variant="bare"
          aria-label="Title"
          placeholder="Title (optional)"
          value={draft.title}
          onChange={(e) => setDraft({ title: e.target.value.replace(/\n/g, ' ') })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              textRef.current?.focus();
            }
          }}
          maxLength={LIMITS.buzzTitle}
          showCount={false}
          minRows={1}
          maxRows={3}
          className="type-title-3"
        />
        <Textarea
          ref={textRef}
          variant="bare"
          aria-label="Your buzz"
          placeholder="What's campus actually thinking?"
          value={draft.text}
          onChange={(e) => setDraft({ text: e.target.value })}
          maxLength={LIMITS.buzzText}
          minRows={4}
          maxRows={12}
          className="type-body-lg"
        />
        <input
          ref={videoInput}
          type="file"
          accept={VIDEO_TYPES}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void pickVideo(file);
          }}
        />
        {videoProgress !== null ? (
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-1 p-3">
            <span className="type-label-sm text-ink">Uploading video…</span>
            <ProgressBar value={videoProgress} aria-label="Video upload" />
          </div>
        ) : draft.video ? (
          <div className="relative overflow-hidden rounded-lg bg-surface-2" style={{ aspectRatio: draft.video.width && draft.video.height ? String(Math.min(1.78, Math.max(0.75, draft.video.width / draft.video.height))) : '16 / 9' }}>
            <video src={`${draft.video.url}#t=0.1`} controls playsInline preload="metadata" className="absolute inset-0 size-full object-contain" aria-label="Your video" />
            <IconButton icon={X} aria-label="Remove video" size="sm" variant="glass" className="absolute top-2 right-2" onClick={() => setDraft({ video: null })} />
          </div>
        ) : (
          <MediaPicker
            value={draft.images}
            onChange={setImages}
            max={LIMITS.buzzImages}
            variant="tray"
            disabled={create.isPending}
            onUploadingChange={setPhotosBusy}
            hint="Up to 4 photos, or one video up to 60 seconds. Location and camera details are removed."
          />
        )}
        {draft.pollOn ? (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1 p-3">
            <div className="flex items-center justify-between">
              <span className="type-label-sm text-ink">Poll</span>
              <span className="type-caption text-ink-3">Results hidden until people vote</span>
            </div>
            {draft.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Option ${i + 1}`}
                  placeholder={`Option ${i + 1}`}
                  value={o}
                  maxLength={LIMITS.pollOptionText}
                  onChange={(e) => setOption(i, e.target.value)}
                  className="flex-1"
                />
                {draft.options.length > LIMITS.pollMinOptions ? <IconButton icon={X} aria-label={`Remove option ${i + 1}`} size="sm" onClick={() => removeOption(i)} /> : null}
              </div>
            ))}
            {draft.options.length < LIMITS.pollMaxOptions ? (
              <Button variant="ghost" size="sm" leftIcon={Plus} onClick={addOption} className="self-start">
                Add option
              </Button>
            ) : null}
            <ChipGroup<`${BuzzPollDuration}`>
              aria-label="Poll duration"
              size="sm"
              value={`${draft.durationDays}`}
              onChange={(v: `${BuzzPollDuration}`) => setDraft({ durationDays: Number(v) as BuzzPollDuration })}
              options={BUZZ_POLL_DURATIONS.map((d) => ({ value: `${d}` as `${BuzzPollDuration}`, label: d === 1 ? '1 day' : `${d} days` }))}
            />
          </div>
        ) : null}
      </div>
    </Sheet>
  );
};

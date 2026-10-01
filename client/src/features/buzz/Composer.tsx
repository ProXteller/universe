/**
 * Buzz composer (design §7.2): a `full` Sheet inside the incognito Surface with the mandatory
 * `ComposerModeBanner mode="incognito"`, bare Textarea (500), poll builder (2–4 options, 1 / 3 / 7 days) and a hero
 * "Buzz it" CTA. No avatar, no handle, no media. Drafts live in the zustand store (wiped on logout, never localStorage).
 */
import { useEffect, useRef, type FC } from 'react';
import { BarChart3, Plus, Sparkles, X } from 'lucide-react';
import { LIMITS } from '@shared/core';
import type { BuzzPollDuration } from '@shared/buzz';
import { BUZZ_POLL_DURATIONS } from '@shared/buzz';
import { Button, Chip, ChipGroup, IconButton, Input, Sheet, Textarea } from '@/ui';
import { ComposerGuard, ComposerModeBanner } from '@/components';
import { errorMessage } from '@/lib/api';
import { handleModerationError, showModerationNotice } from '@/lib/moderation';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useBuzzMeta, useCreateBuzz } from './api';
import { useBuzzStore } from './store';

const HOUR = 3_600_000;
const SMALL_CAMPUS_NOTE = 'Small campus: be mindful that details can identify you.';
const DEFAULT_NOTE = "Other students can't see who you are. Community Guidelines still apply.";

export const BuzzComposer: FC = () => {
  const me = useMe();
  const open = useBuzzStore((s) => s.composerOpen);
  const draft = useBuzzStore((s) => s.draft);
  const scope = useBuzzStore((s) => s.scope);
  const { closeComposer, setDraft, clearDraft } = useBuzzStore.getState();
  const meta = useBuzzMeta(scope);
  const create = useCreateBuzz();
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) window.setTimeout(() => textRef.current?.focus(), 60);
  }, [open]);

  const canPoll = Date.now() - me.createdAt >= 24 * HOUR;
  const text = draft.text.trim();
  const options = draft.options.map((o) => o.trim());
  const pollValid = !draft.pollOn || (options.filter(Boolean).length >= LIMITS.pollMinOptions && options.filter(Boolean).length === options.length && new Set(options.map((o) => o.toLowerCase())).size === options.length);
  const canSubmit = text.length > 0 && text.length <= LIMITS.buzzText && pollValid && !create.isPending;
  const prompt = draft.promptId && meta.data?.prompt?.id === draft.promptId ? meta.data.prompt : null;

  const submit = (): void => {
    if (!canSubmit) return;
    create.mutate(
      {
        text,
        ...(draft.pollOn ? { poll: { options, durationDays: draft.durationDays } } : {}),
        ...(draft.promptId ? { promptId: draft.promptId } : {}),
      },
      {
        onSuccess: (res) => {
          showModerationNotice(res.moderation);
          if (res.moderation.status !== 'held') toast.success('Buzzed. Your alias in this thread is ' + res.alias.label + '.');
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
          <div className="flex items-center gap-3">
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
            <span className="flex-1 truncate type-caption text-ink-3">{!canPoll ? 'Polls unlock 24 hours after you join' : 'Goes to your campus feed and shows on Global'}</span>
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

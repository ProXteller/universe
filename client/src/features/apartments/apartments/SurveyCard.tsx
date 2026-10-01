/**
 * Micro-survey card (SPEC §5.10 / product §2.10 / design §7.7): one question at a time with choice Chips, StepDots,
 * skippable; after each answer the REAL campus split is shown ("42% at {university} said Price"). Budget labels go
 * through `formatPrice` in the viewer's campus currency.
 */
import { useEffect, useMemo, useRef, useState, type FC } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Sparkles } from 'lucide-react';
import { SURVEY, SURVEY_QUESTION_IDS, SURVEY_THANKS, type SurveyOption, type SurveyQuestionId, type SurveySplit, type SurveyState } from '@shared/apartments';
import { Button, Card, ChipGroup, ErrorState, ProgressBar, Skeleton, StepDots } from '@/ui';
import { track } from '@/lib/analytics';
import { errorMessage } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useFadeUp, useSpringPreset } from '@/lib/motion';
import { toast } from '@/lib/toast';

/** Budget option labels are templates ("{min}–{max}") filled with the campus currency. */
export function optionLabel(o: SurveyOption): string {
  return o.label.replace('{min}', o.min !== undefined ? formatPrice(o.min) : '').replace('{max}', o.max !== undefined ? formatPrice(o.max) : '');
}

const questionOf = (id: SurveyQuestionId) => SURVEY.find((q) => q.id === id)!;

function firstUnanswered(state: SurveyState): number {
  const i = SURVEY_QUESTION_IDS.findIndex((q) => (state.answers[q]?.length ?? 0) === 0);
  return i === -1 ? SURVEY.length : i;
}

function splitLine(split: SurveySplit, chosen: readonly string[], university: string): string {
  const def = questionOf(split.question);
  const first = chosen[0];
  const opt = split.options.find((o) => o.id === first);
  const label = def.options.find((o) => o.id === first);
  if (!opt || !label || split.total === 0) return `You're the first at ${university} to answer.`;
  return `${opt.pct}% at ${university} said ${optionLabel(label)}`;
}

const SplitBars: FC<{ split: SurveySplit; chosen: readonly string[] }> = ({ split, chosen }) => {
  const def = questionOf(split.question);
  return (
    <ul className="flex flex-col gap-1.5" aria-label="Campus split">
      {split.options.map((o) => {
        const label = def.options.find((x) => x.id === o.id);
        const mine = chosen.includes(o.id);
        return (
          <li key={o.id} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2 type-caption">
              <span className={mine ? 'text-ink' : 'text-ink-3'}>{label ? optionLabel(label) : o.id}</span>
              <span className="tabular-nums text-ink-3">{o.pct}%</span>
            </div>
            <ProgressBar value={o.pct / 100} aria-label={`${label ? optionLabel(label) : o.id}: ${o.pct} percent`} className={mine ? undefined : 'opacity-60'} />
          </li>
        );
      })}
    </ul>
  );
};

export interface SurveyCardProps {
  state: SurveyState | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry(): void;
  university: string;
  answer(question: SurveyQuestionId, answer: string[]): Promise<SurveySplit>;
}

export const SurveyCard: FC<SurveyCardProps> = ({ state, isLoading, error, onRetry, university, answer }) => {
  const fadeUp = useFadeUp();
  const smooth = useSpringPreset('smooth');
  const [step, setStep] = useState<number | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [reveal, setReveal] = useState<{ question: SurveyQuestionId; split: SurveySplit; chosen: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  // First unanswered question once the state arrives (never jumps while the user is mid-way).
  useEffect(() => {
    if (state && step === null) setStep(firstUnanswered(state));
  }, [state, step]);

  const current = step !== null && step < SURVEY.length ? SURVEY[step] : null;
  const done = step !== null && step >= SURVEY.length;
  const answeredCount = useMemo(() => (state ? SURVEY_QUESTION_IDS.filter((q) => (state.answers[q]?.length ?? 0) > 0).length : 0), [state]);

  const submit = async (question: SurveyQuestionId, chosen: string[]) => {
    if (busy || chosen.length === 0) return;
    if (!started.current && answeredCount === 0) {
      started.current = true;
      track('apartments.survey_start');
    }
    setBusy(true);
    try {
      const split = await answer(question, chosen);
      track('apartments.survey_answer', { question, answer: chosen.join(',') });
      setReveal({ question, split, chosen });
      // Fire `survey_complete` exactly once: when this answer fills the last gap AND the survey was not already
      // complete before it (`state` here is the pre-answer closure value, so a later "Change" never re-fires).
      const wasLast = SURVEY_QUESTION_IDS.every((q) => q === question || (state?.answers[q]?.length ?? 0) > 0);
      if (wasLast && !state?.completed) track('apartments.survey_complete');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const advance = () => {
    setReveal(null);
    setPending([]);
    setStep((s) => (s === null ? 0 : s + 1));
  };

  const jumpTo = (i: number) => {
    setReveal(null);
    setPending(state?.answers[SURVEY_QUESTION_IDS[i]!] ?? []);
    setStep(i);
  };

  if (isLoading || (!state && !error)) {
    return (
      <Card className="flex flex-col gap-3" aria-busy="true" aria-label="Loading survey">
        <Skeleton w="55%" h={16} />
        <div className="flex flex-wrap gap-2">
          <Skeleton w={110} h={36} className="rounded-full" />
          <Skeleton w={124} h={36} className="rounded-full" />
          <Skeleton w={90} h={36} className="rounded-full" />
        </div>
        <Skeleton w={64} h={8} />
      </Card>
    );
  }
  if (!state) {
    return (
      <Card>
        <ErrorState inline title="Couldn't load the survey." error={error} onRetry={onRetry} />
      </Card>
    );
  }

  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show">
      <Card variant="raised" className="flex flex-col gap-4">
        <AnimatePresence mode="wait" initial={false}>
          {reveal ? (
            <motion.div key={`reveal-${reveal.question}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={smooth} className="flex flex-col gap-3">
              <p className="type-headline text-ink">{splitLine(reveal.split, reveal.chosen, university)}</p>
              <SplitBars split={reveal.split} chosen={reveal.chosen} />
              <p className="type-caption text-ink-3">{reveal.split.total} {reveal.split.total === 1 ? 'answer' : 'answers'} at {university} so far.</p>
              <Button variant="secondary" rightIcon={ChevronRight} onClick={advance} className="self-end">
                {step !== null && step + 1 < SURVEY.length ? 'Next' : 'Done'}
              </Button>
            </motion.div>
          ) : current ? (
            <motion.div key={`q-${current.id}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={smooth} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <h2 className="type-headline text-ink">{current.title}</h2>
                <span className="shrink-0 type-caption tabular-nums text-ink-3">
                  {step! + 1}/{SURVEY.length}
                </span>
              </div>
              <ChipGroup
                options={current.options.map((o) => ({ value: o.id, label: optionLabel(o) }))}
                value={current.multi ? pending : (pending[0] ?? null)}
                onChange={(v: string | string[]) => {
                  if (current.multi) {
                    setPending(Array.isArray(v) ? v : [v]);
                    return;
                  }
                  const chosen = [Array.isArray(v) ? v[0]! : v];
                  setPending(chosen);
                  void submit(current.id, chosen);
                }}
                multiple={current.multi}
                max={current.multi ? current.max : undefined}
                scroll="wrap"
                aria-label={current.title}
              />
              <div className="flex items-center justify-between gap-3">
                <StepDots total={SURVEY.length} current={step! + 1} />
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={advance} disabled={busy}>
                    Skip
                  </Button>
                  {current.multi ? (
                    <Button size="sm" loading={busy} disabled={pending.length === 0} onClick={() => void submit(current.id, pending)}>
                      Continue
                    </Button>
                  ) : null}
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={smooth} className="flex flex-col gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
                  <Sparkles size={18} strokeWidth={1.75} aria-hidden />
                </span>
                <p className="type-headline text-ink">{state.completed ? SURVEY_THANKS : `${answeredCount} of ${SURVEY.length} answered.`}</p>
              </div>
              <ul className="flex flex-col divide-y divide-line-subtle">
                {SURVEY.map((q, i) => {
                  const chosen = state.answers[q.id] ?? [];
                  const split = state.splits.find((s) => s.question === q.id);
                  return (
                    <li key={q.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate type-footnote text-ink-3">{q.title}</p>
                        <p className="truncate type-body text-ink">
                          {chosen.length > 0 ? chosen.map((id) => optionLabel(q.options.find((o) => o.id === id) ?? { id, label: id })).join(', ') : 'Skipped'}
                        </p>
                        {split && chosen.length > 0 ? <p className="truncate type-caption text-accent-ink">{splitLine(split, chosen, university)}</p> : null}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => jumpTo(i)}>
                        {chosen.length > 0 ? 'Change' : 'Answer'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {!done ? null : <StepDots total={SURVEY.length} current={SURVEY.length} className="self-start" />}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};

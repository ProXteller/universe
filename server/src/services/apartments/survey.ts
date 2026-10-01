/**
 * Apartments micro-survey (SPEC §5.10): one row per (user, question) in `apartment_survey_answers`; the split is
 * computed live over the viewer's campus. Answers are option ids — no free text, so nothing here is UGC.
 * Prepared statements are created lazily through `prep()` (R4: no import-time DB access).
 */
import type { EpochMs, Id } from '@shared/core';
import { SURVEY, SURVEY_QUESTION_IDS, type SurveyQuestion, type SurveyQuestionId, type SurveySplit, type SurveyState } from '@shared/apartments';
import { json, newId, prep } from '../../db/index';
import { now } from '../../lib/clock';
import { ApiError } from '../../lib/http';

interface SurveyRow {
  id: Id;
  user_id: Id;
  university_id: Id;
  question: SurveyQuestionId;
  answer_json: string;
  created_at: EpochMs;
  updated_at: EpochMs;
}

export function questionDef(question: string): SurveyQuestion<SurveyQuestionId> | null {
  return (SURVEY as readonly SurveyQuestion<SurveyQuestionId>[]).find((q) => q.id === question) ?? null;
}

export function isSurveyQuestionId(q: string): q is SurveyQuestionId {
  return (SURVEY_QUESTION_IDS as readonly string[]).includes(q);
}

/** Validates + normalises an answer against the question definition (400 `validation_failed` on any problem). */
export function normalizeAnswer(question: SurveyQuestionId, answer: readonly string[]): string[] {
  const def = questionDef(question);
  if (!def) throw new ApiError(400, 'validation_failed', 'Unknown survey question.');
  const valid = new Set(def.options.map((o) => o.id));
  const unique = [...new Set(answer)];
  if (unique.length === 0) throw new ApiError(400, 'validation_failed', 'Pick at least one option.');
  if (unique.length > def.max) {
    throw new ApiError(400, 'validation_failed', def.max === 1 ? 'Pick one option.' : `Pick up to ${def.max} options.`);
  }
  for (const id of unique) {
    if (!valid.has(id)) throw new ApiError(400, 'validation_failed', `Unknown option "${id}".`);
  }
  return unique;
}

function rowsFor(userId: Id): SurveyRow[] {
  return prep('SELECT * FROM apartment_survey_answers WHERE user_id = ? ORDER BY question').all(userId) as SurveyRow[];
}

/** Campus split for one question: distinct answerers at `universityId`; a multi-select question's pcts may sum > 100. */
export function splitFor(universityId: Id, question: SurveyQuestionId): SurveySplit {
  const def = questionDef(question);
  if (!def) throw new ApiError(400, 'validation_failed', 'Unknown survey question.');
  const rows = prep('SELECT answer_json FROM apartment_survey_answers WHERE university_id = ? AND question = ?').all(universityId, question) as {
    answer_json: string;
  }[];
  const counts = new Map<string, number>(def.options.map((o) => [o.id, 0]));
  let total = 0;
  for (const r of rows) {
    const answer = json<string[]>(r.answer_json, []);
    if (!Array.isArray(answer) || answer.length === 0) continue;
    total += 1;
    for (const id of new Set(answer)) if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return {
    question,
    total,
    options: def.options.map((o) => {
      const count = counts.get(o.id) ?? 0;
      return { id: o.id, count, pct: total === 0 ? 0 : Math.round((count / total) * 100) };
    }),
  };
}

export function surveyStateFor(userId: Id, universityId: Id): SurveyState {
  const answers: SurveyState['answers'] = {};
  for (const r of rowsFor(userId)) {
    if (!isSurveyQuestionId(r.question)) continue;
    const answer = json<string[]>(r.answer_json, []);
    if (Array.isArray(answer) && answer.length > 0) answers[r.question] = answer;
  }
  const answered = SURVEY_QUESTION_IDS.filter((q) => answers[q] !== undefined);
  return {
    answers,
    completed: answered.length === SURVEY_QUESTION_IDS.length,
    splits: answered.map((q) => splitFor(universityId, q)),
  };
}

/** Upserts the viewer's answer (the row follows the viewer's CURRENT campus) and returns the fresh campus split. */
export function answerSurvey(userId: Id, universityId: Id, question: SurveyQuestionId, answer: readonly string[]): SurveySplit {
  const normalized = normalizeAnswer(question, answer);
  const at = now();
  const existing = prep('SELECT id FROM apartment_survey_answers WHERE user_id = ? AND question = ?').get(userId, question) as { id: Id } | undefined;
  if (existing) {
    prep('UPDATE apartment_survey_answers SET answer_json = ?, university_id = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(normalized), universityId, at, existing.id,
    );
  } else {
    prep(
      'INSERT INTO apartment_survey_answers (id, user_id, university_id, question, answer_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run(newId(), userId, universityId, question, JSON.stringify(normalized), at, at);
  }
  return splitFor(universityId, question);
}

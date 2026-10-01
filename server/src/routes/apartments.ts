/**
 * `apartments` router (SPEC §5.10) — mounted at `/api/apartments` by foundation with `requireAuth + requireOnboarded`.
 *
 *   GET /survey            → SurveyState (answers + live campus splits for answered questions)
 *   PUT /survey/:question  { answer: string[] } → SurveySplit
 *
 * Waitlist (#34–#35), notifications (#31–#32), settings / blocks / invite / sanctions / appeals (#9–#20) are
 * foundation endpoints; the slice consumes them from the client. Survey answers are option ids, not UGC text,
 * so there is no moderation pass, content adapter or rate action for them. No import-time DB access (R4).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { SurveyAnswerRequest, SurveyQuestionId, SurveySplit, SurveyState } from '@shared/apartments';
import { SURVEY_QUESTION_IDS } from '@shared/apartments';
import { asyncHandler, noStore, typed, validate } from '../lib/http';
import { answerSurvey, surveyStateFor } from '../services/apartments/survey';

const router = Router();

const questionParams = z.object({
  question: z.enum(SURVEY_QUESTION_IDS as [SurveyQuestionId, ...SurveyQuestionId[]]),
});

const answerBody = z.object({
  answer: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
});

router.get(
  '/survey',
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const out: SurveyState = surveyStateFor(user.id, user.universityId);
    res.json(out);
  }),
);

router.put(
  '/survey/:question',
  validate({ params: questionParams, body: answerBody }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { params, body } = typed<SurveyAnswerRequest, unknown, { question: SurveyQuestionId }>(req);
    const out: SurveySplit = answerSurvey(user.id, user.universityId, params.question, body.answer);
    res.json(out);
  }),
);

export default router;

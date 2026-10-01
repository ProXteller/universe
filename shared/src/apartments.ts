/**
 * `apartments` slice — request / response types (SPEC §5.10). Types + constants only, zero imports.
 * Imported as `@shared/apartments` by the apartments client + server pair only.
 */

export interface SurveyOption {
  id: string;
  /**
   * Display label. Budget options are templates (`{min}` / `{max}` placeholders) that the client fills with
   * `formatPrice()` in the viewer's campus currency — numeric thresholds are not converted in v1 (SPEC §5.10).
   */
  label: string;
  /** Budget buckets only: whole units of the campus currency. */
  min?: number;
  max?: number;
}

export interface SurveyQuestion<Q extends string = string> {
  id: Q;
  title: string;
  multi: boolean;
  /** Maximum number of selected options (1 for single-choice questions). */
  max: number;
  options: readonly SurveyOption[];
}

/** product §2.10 copy — three taps. */
export const SURVEY = [
  {
    id: 'when',
    title: 'When do you need a place?',
    multi: false,
    max: 1,
    options: [
      { id: 'this_semester', label: 'This semester' },
      { id: 'next_semester', label: 'Next semester' },
      { id: 'next_fall', label: 'Next fall' },
      { id: 'browsing', label: 'Just browsing' },
    ],
  },
  {
    id: 'budget',
    title: 'Max monthly budget, your share?',
    multi: false,
    max: 1,
    options: [
      { id: 'under_600', label: 'Under {max}', max: 600 },
      { id: '600_900', label: '{min}–{max}', min: 600, max: 900 },
      { id: '900_1300', label: '{min}–{max}', min: 900, max: 1300 },
      { id: '1300_plus', label: '{min}+', min: 1300 },
    ],
  },
  {
    id: 'priorities',
    title: 'What matters most? Pick up to two.',
    multi: true,
    max: 2,
    options: [
      { id: 'price', label: 'Price' },
      { id: 'walk', label: 'Walk to campus' },
      { id: 'flexible_lease', label: 'Flexible lease' },
      { id: 'safety', label: 'Safety' },
      { id: 'laundry', label: 'In-unit laundry' },
    ],
  },
] as const satisfies readonly SurveyQuestion[];

export type SurveyQuestionId = (typeof SURVEY)[number]['id'];

export const SURVEY_QUESTION_IDS: readonly SurveyQuestionId[] = ['when', 'budget', 'priorities'];

/** Live campus split for one question (viewer's campus). `pct` is a rounded integer 0–100. */
export interface SurveySplit {
  question: SurveyQuestionId;
  /** Distinct users at the viewer's campus who answered this question. */
  total: number;
  options: { id: string; count: number; pct: number }[];
}

export interface SurveyState {
  answers: Partial<Record<SurveyQuestionId, string[]>>;
  /** Every question answered. */
  completed: boolean;
  /** Only for answered questions. */
  splits: SurveySplit[];
}

export interface SurveyAnswerRequest {
  answer: string[];
}

/** Copy shown when the last question is answered (product §2.10). */
export const SURVEY_THANKS = 'Thanks. This helps decide which campuses launch first.';

/**
 * Compatibility math (SPEC §5.7) — pure, no DB, unit-tested.
 *
 *   pct = round(Σ w_q · (1 − |a_q − b_q| / 3))
 *   dealbreaker conflict (dealbreak_smoking vs other smoking ≥ 2; dealbreak_pets vs other pets = 3, either direction)
 *     → min(pct, 35), capped: true
 *   both    = tags where the answers are equal
 *   differs = questions where |Δ| ≥ 2
 *   archetype = {clean ≥ 2 ? 'Tidy' : 'Easygoing'} {sleep ≤ 1 ? 'Early Bird' : 'Night Owl'}
 */
import {
  COMPAT_CAP, COMPAT_WEIGHTS, MONTH_LONG, MONTH_SHORT, QUESTION_DEFS, ROOMMATE_QUESTIONS,
  type Compatibility, type RoommateAnswers, type RoommateQuestion,
} from '@shared/roommates';

export interface CompatParty {
  answers: RoommateAnswers;
  dealbreakSmoking: boolean;
  dealbreakPets: boolean;
}

/** Human keyword for a question in "Differs: guests, sleep." */
const DIFFER_WORD: Record<RoommateQuestion, string> = {
  sleep: 'sleep schedule', clean: 'tidiness', noise: 'noise', guests: 'guests', hosting: 'parties',
  smoking: 'smoking', pets: 'pets', sharing: 'sharing',
};

export function similarityOf(a: number, b: number): number {
  return 1 - Math.min(3, Math.abs(a - b)) / 3;
}

export function hasDealbreakerConflict(a: CompatParty, b: CompatParty): boolean {
  if (a.dealbreakSmoking && b.answers.smoking >= 2) return true;
  if (b.dealbreakSmoking && a.answers.smoking >= 2) return true;
  if (a.dealbreakPets && b.answers.pets === 3) return true;
  if (b.dealbreakPets && a.answers.pets === 3) return true;
  return false;
}

export function tagFor(q: RoommateQuestion, answer: number): string {
  const idx = Math.max(0, Math.min(3, Math.round(answer)));
  return QUESTION_DEFS[q].tags[idx as 0 | 1 | 2 | 3];
}

export function computeCompatibility(viewer: CompatParty, other: CompatParty): Compatibility {
  let sum = 0;
  const dimensions: Compatibility['dimensions'] = [];
  const both: string[] = [];
  const differs: string[] = [];
  for (const q of ROOMMATE_QUESTIONS) {
    const a = viewer.answers[q];
    const b = other.answers[q];
    const similarity = similarityOf(a, b);
    sum += COMPAT_WEIGHTS[q] * similarity;
    dimensions.push({ q, similarity: Math.round(similarity * 1000) / 1000 });
    if (a === b) both.push(tagFor(q, a));
    else if (Math.abs(a - b) >= 2) differs.push(DIFFER_WORD[q]);
  }
  const raw = Math.round(sum);
  const capped = hasDealbreakerConflict(viewer, other);
  const pct = capped ? Math.min(raw, COMPAT_CAP) : raw;
  return { pct, capped, dimensions, both, differs, sentence: sentenceFor(both, differs, capped) };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function sentenceFor(both: string[], differs: string[], capped: boolean): string {
  const parts: string[] = [];
  if (both.length) parts.push(`You both: ${joinList(both.slice(0, 3))}.`);
  if (differs.length) parts.push(`Differs: ${joinList(differs.slice(0, 3))}.`);
  if (capped) parts.push('A dealbreaker caps this match.');
  return parts.join(' ') || 'Answer the questions to see how you match.';
}

export function archetypeOf(answers: RoommateAnswers): string {
  const tidy = answers.clean >= 2 ? 'Tidy' : 'Easygoing';
  const bird = answers.sleep <= 1 ? 'Early Bird' : 'Night Owl';
  return `${tidy} ${bird}`;
}

/** The 3 lifestyle tags shown on a card: the most distinctive answers first (sleep, clean, noise, then the rest). */
export function tagsOf(answers: RoommateAnswers): string[] {
  const order: RoommateQuestion[] = ['sleep', 'clean', 'noise', 'pets', 'guests', 'smoking', 'hosting', 'sharing'];
  const out: string[] = [];
  for (const q of order) {
    if (out.length === 3) break;
    out.push(tagFor(q, answers[q]));
  }
  return out;
}

/** The tag the viewer shares with the other person (first equal answer in card order), for the opener. */
export function sharedTag(viewer: RoommateAnswers | null, other: RoommateAnswers): string | null {
  if (!viewer) return null;
  const order: RoommateQuestion[] = ['sleep', 'clean', 'noise', 'pets', 'guests', 'smoking', 'hosting', 'sharing'];
  for (const q of order) if (viewer[q] === other[q]) return tagFor(q, other[q]);
  return null;
}

export function isAnswers(v: unknown): v is RoommateAnswers {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return ROOMMATE_QUESTIONS.every((q) => {
    const n = o[q];
    return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 3;
  });
}

/** 'YYYY-MM' → 'Aug 2026' (server twin of the client formatter; shared holds only the month names). */
export function formatMoveIn(moveIn: string | null | undefined): string {
  if (!moveIn) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(moveIn);
  if (!m) return moveIn;
  return `${MONTH_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function moveInMonthName(moveIn: string | null | undefined): string | null {
  if (!moveIn) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(moveIn);
  if (!m) return null;
  return MONTH_LONG[Number(m[2]) - 1] ?? null;
}

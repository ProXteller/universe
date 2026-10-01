/**
 * `apartments` seed (SPEC §5.10 / §7.5). Deterministic (`kit.rng` only), both scales.
 *
 *  waitlist:  ~260 rows at full / 40 at lite, across campuses, written ONLY through `kit.waitlist()` (R2: core table).
 *             Maya joined (source 'nav'), survey unanswered.
 *  survey:    answers for ~60 % of waitlisters (`apartment_survey_answers`, direct SQL — the slice's own table),
 *             plus a few partial answerers (Q1 only). Rows carry the user's campus so the live split is campus-scoped.
 *  analytics: `apartments.*` events over the last 30 days through `kit.track`, shaped so the admin funnel reads
 *             ≈ 100 % page views → 38 % CTA clicks → 61 % of CTA completing the survey (page_view : cta_click :
 *             survey_complete). Per-question `survey_answer` rows, a few `cta_undo` (followed by a re-join), share
 *             and roommates cross-link taps, and a dwell event for a share of sessions round the picture out.
 */
import type { AnalyticsEventName, AnalyticsProps, EpochMs } from '@shared/core';
import { SURVEY, type SurveyQuestionId } from '@shared/apartments';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { DAY, MIN } from '../../lib/clock';
import { U } from './ids';

const SEC = 1000;
const WINDOW_MS = 30 * DAY;

const SOURCES = ['nav', 'nav', 'nav', 'nav', 'nav', 'nav', 'nav', 'campus', 'campus', 'link'] as const;

function dwellBucket(ms: number): string {
  if (ms < 5 * SEC) return '<5s';
  if (ms < 15 * SEC) return '5-15s';
  if (ms < 60 * SEC) return '15-60s';
  return '60s+';
}

export default function seed(kit: SeedKit): void {
  const full = kit.scale === 'full';
  const target = full ? 260 : 40;

  const maya = kit.users.get(U.mayachen);
  // Students (incl. staff, who are normal student profiles) at every campus; orgs do not look for apartments.
  const candidates = kit.users.all.filter((u) => u.accountType === 'student' && u.id !== maya.id);
  const waitlisters: SeedUser[] = [maya, ...kit.sample(candidates, Math.min(target - 1, candidates.length))];
  const waitlisted = new Set(waitlisters.map((u) => u.id));
  const others = waitlisters.filter((u) => u.id !== maya.id);

  // Stratified (not per-user chance) so the funnel holds at BOTH scales: 4 % undo + re-join, then 61 % of CTA
  // clicks complete the survey and a further 8 % answer only the first question.
  const undoers = new Set(kit.sample(others, Math.round(others.length * 0.04)).map((u) => u.id));
  const ctaEvents = waitlisters.length + undoers.size;
  const shuffled = kit.sample(others, others.length);
  const completeCount = Math.min(others.length, Math.round(ctaEvents * 0.61));
  const partialCount = Math.min(others.length - completeCount, Math.round(others.length * 0.08));
  const completers = new Set(shuffled.slice(0, completeCount).map((u) => u.id));
  const partials = new Set(shuffled.slice(completeCount, completeCount + partialCount).map((u) => u.id));

  const insertAnswer = kit.db.prepare(
    'INSERT INTO apartment_survey_answers (id, user_id, university_id, question, answer_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
  );
  let answerRows = 0;

  const track = (name: AnalyticsEventName, user: SeedUser, props: AnalyticsProps, at: EpochMs): void => {
    kit.track(name, user, props, at);
  };

  /** One visit: page_view (+ maybe dwell later). Returns the leave time. */
  const visit = (user: SeedUser, at: EpochMs, source: string, lastActionAt: EpochMs): EpochMs => {
    track('apartments.page_view', user, { source }, at);
    const leaveAt = Math.max(lastActionAt, at) + kit.int(4, 90) * SEC;
    // Dwell fires on leave (sendBeacon); a share of sessions never flush it — mirror that.
    if (kit.chance(0.35)) {
      const dwellMs = leaveAt - at;
      track('apartments.dwell', user, { dwellMs, dwellBucket: dwellBucket(dwellMs) }, leaveAt);
    }
    return leaveAt;
  };

  const pickAnswer = (question: (typeof SURVEY)[number]): string[] => {
    const ids = question.options.map((o) => o.id);
    if (!question.multi) {
      // Weighted toward the realistic middle (next semester / 600–900 / price + walk).
      const roll = kit.rng();
      const idx = roll < 0.42 ? 1 : roll < 0.66 ? 0 : roll < 0.86 ? 2 : Math.min(3, ids.length - 1);
      return [ids[idx]!];
    }
    const n = kit.chance(0.7) ? 2 : 1;
    const weighted = [...ids, ids[0]!, ids[1]!]; // price + walk are picked most
    const out: string[] = [];
    while (out.length < n) {
      const pick = kit.pick(weighted);
      if (!out.includes(pick)) out.push(pick);
    }
    return out;
  };

  const writeAnswer = (user: SeedUser, question: SurveyQuestionId, answer: string[], at: EpochMs): void => {
    answerRows += 1;
    insertAnswer.run(kit.id('aptsv', answerRows), user.id, user.universityId, question, JSON.stringify(answer), at, at);
  };

  /* ───────────────────────────── waitlisters: view → join → survey ───────────────────────────── */

  for (const user of waitlisters) {
    const isMaya = user.id === maya.id;
    const joinAt = isMaya ? kit.ago({ d: 5, h: 3, m: 12 }) : kit.now - kit.int(40 * MIN, WINDOW_MS);
    const source = isMaya ? 'nav' : kit.pick(SOURCES);
    const viewAt = joinAt - kit.int(15, 120) * SEC;
    let lastAt = joinAt;
    let finalJoinAt = joinAt;
    let finalSource: string = source;

    track('apartments.cta_click', user, { source }, joinAt);

    // A few people leave the list right away and come back a couple of minutes later.
    if (undoers.has(user.id)) {
      const undoAt = joinAt + kit.int(30, 90) * SEC;
      track('apartments.cta_undo', user, {}, undoAt);
      finalJoinAt = undoAt + kit.int(2, 6) * MIN;
      finalSource = 'nav';
      track('apartments.cta_click', user, { source: finalSource }, finalJoinAt);
      lastAt = finalJoinAt;
    }

    kit.waitlist(user, 'apartments', finalJoinAt, finalSource);

    if (!isMaya) {
      const completes = completers.has(user.id);
      const partial = partials.has(user.id);
      if (completes || partial) {
        let t = lastAt + kit.int(3, 10) * SEC;
        track('apartments.survey_start', user, {}, t);
        const questions = completes ? SURVEY : SURVEY.slice(0, 1);
        for (const q of questions) {
          t += kit.int(4, 14) * SEC;
          const answer = pickAnswer(q);
          track('apartments.survey_answer', user, { question: q.id, answer: answer.join(',') }, t);
          writeAnswer(user, q.id, answer, t);
        }
        if (completes) {
          t += 2 * SEC;
          track('apartments.survey_complete', user, {}, t);
        }
        lastAt = t;
      }
      if (kit.chance(0.08)) {
        lastAt += kit.int(3, 20) * SEC;
        track('apartments.roommates_crosslink_click', user, {}, lastAt);
      }
      if (kit.chance(0.03)) {
        lastAt += kit.int(3, 20) * SEC;
        track('apartments.share_click', user, { method: kit.chance(0.5) ? 'native' : 'copy' }, lastAt);
      }
    }

    visit(user, viewAt, source, lastAt);
  }

  // Maya came back two days later, already on the list, and followed the roommates cross-link (§7.5: survey unanswered).
  {
    const at = kit.ago({ d: 2, h: 1, m: 40 });
    const clickAt = at + 21 * SEC;
    track('apartments.roommates_crosslink_click', maya, {}, clickAt);
    visit(maya, at, 'nav', clickAt);
  }

  /* ───────────────────────────── extra visits: views without a CTA (funnel ≈ 38 % CTA) ───────────────────────────── */

  const targetViews = Math.round(ctaEvents / 0.38);
  const alreadyViews = waitlisters.length + 1;
  const extraViews = Math.max(0, targetViews - alreadyViews);
  const viewers = kit.users.all.filter((u) => u.accountType === 'student');
  for (let i = 0; i < extraViews; i++) {
    // Non-members browse a little more than members re-checking the page.
    const pool = kit.chance(0.55) ? viewers.filter((u) => !waitlisted.has(u.id)) : viewers;
    const user = kit.pick(pool.length > 0 ? pool : viewers);
    const at = kit.now - kit.int(20 * MIN, WINDOW_MS);
    let lastAt = at;
    if (kit.chance(0.1)) {
      lastAt = at + kit.int(5, 40) * SEC;
      track('apartments.roommates_crosslink_click', user, {}, lastAt);
    } else if (kit.chance(0.03)) {
      lastAt = at + kit.int(5, 40) * SEC;
      track('apartments.share_click', user, { method: 'copy' }, lastAt);
    }
    visit(user, at, kit.pick(SOURCES), lastAt);
  }
}

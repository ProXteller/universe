/**
 * Course-code normalisation (SPEC §4.2.15). Used by `campus` (courses) and `market` (listing `courseCode`) so deep
 * links match. Client twin: `normalizeCourseCode` in `client/src/lib/format.ts`.
 *
 * trim → uppercase → collapse whitespace → exactly one space between the department letters and the number:
 * "cs314" → "CS 314" · "bio 311c" → "BIO 311C" · "E E 302" stays. Must match COURSE_CODE_REGEX, else null.
 */
export const COURSE_CODE_REGEX = /^[A-Z]( ?[A-Z]){0,4} \d{2,4}[A-Z]?$/;

export function normalizeCourseCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().toUpperCase().replace(/\s+/g, ' ');
  const m = /^([A-Z](?: ?[A-Z]){0,4}) ?(\d{2,4}[A-Z]?)$/.exec(s);
  if (!m) return null;
  const code = `${m[1]} ${m[2]}`;
  return COURSE_CODE_REGEX.test(code) ? code : null;
}

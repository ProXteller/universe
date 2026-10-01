/**
 * Shared SQL fragments for the discover slice. Everything here reads CORE tables only (users, follows, blocks,
 * universities, public_activity) plus the slice's own `discover_dismissals`. Never a Buzz table (SPEC §3.2 #5).
 */
import type { Id } from '@shared/core';
import type { SuggestionSection } from '@shared/discover';
import { prep } from '../../db/index';
import { sqlNotBlocked } from '../../lib/graph';

/**
 * Users the viewer may see on any public surface: active, not on a hidden campus (`uni_team`), no block either
 * way. `alias` is the `users` alias of the caller's query.
 */
export function visibleUsersSql(viewerId: Id, alias: string): { sql: string; params: string[] } {
  const nb = sqlNotBlocked(viewerId, `${alias}.id`);
  return {
    sql: `${alias}.status = 'active' AND ${nb.sql} AND NOT EXISTS (SELECT 1 FROM universities _hu WHERE _hu.id = ${alias}.university_id AND _hu.is_hidden = 1)`,
    params: nb.params,
  };
}

/** `NOT EXISTS` fragments that drop candidates the viewer already follows or dismissed in `section`. */
export function suggestionExclusionsSql(viewerId: Id, alias: string, section: SuggestionSection): { sql: string; params: string[] } {
  return {
    sql: `${alias}.id != ?
      AND NOT EXISTS (SELECT 1 FROM follows _f WHERE _f.follower_id = ? AND _f.followee_id = ${alias}.id)
      AND NOT EXISTS (SELECT 1 FROM discover_dismissals _d WHERE _d.user_id = ? AND _d.target_id = ${alias}.id AND _d.section = ?)`,
    params: [viewerId, viewerId, viewerId, section],
  };
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Real COUNT of active accounts at a campus (product rule 5: numbers are real). */
export function campusMemberCount(universityId: Id): number {
  return (prep("SELECT COUNT(*) AS n FROM users WHERE university_id = ? AND status = 'active'").get(universityId) as { n: number }).n;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

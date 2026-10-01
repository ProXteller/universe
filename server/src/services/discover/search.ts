/**
 * Discover search (SPEC §5.5 `GET /discover/search`): ONE `Paginated<SearchHit>` ordered campus-first server-side.
 * The campus-first ordering is part of the keyset cursor: every row gets a composite integer sort key
 *   k = campusTier · 1e11 + matchTier · 1e10 + (1e10 − 1 − follower_count)
 * and pages continue with `(k, id) > (cursor.k, cursor.id)`, so page boundaries never break the order.
 * Blocked users (either way), non-active accounts and hidden campuses (`uni_team`) never appear.
 */
import type { Id, UserListItem } from '@shared/core';
import type { DiscoverSearchResponse, DiscoverSearchType, SearchHit, SearchMatch } from '@shared/discover';
import { db } from '../../db/index';
import { decodeCursor, keysetWhere, paginate } from '../../lib/http';
import { userListItemsByIds, type AuthedUser } from '../../lib/users';
import { escapeLike, visibleUsersSql } from './common';

interface SearchRow {
  id: Id;
  handle: string;
  display_name: string;
  major: string | null;
  university_id: Id;
  k: number;
}

export interface SearchInput {
  q: string;
  type: DiscoverSearchType;
  cursor?: string;
  limit: number;
}

/** Normalises a query: trims, drops a leading `@`, collapses whitespace. Empty → ''. */
export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/\s+/g, ' ').trim();
}

function matchKind(row: SearchRow, needle: string): SearchMatch {
  const q = needle.toLowerCase();
  const handle = row.handle.toLowerCase();
  const name = row.display_name.toLowerCase();
  if (handle.startsWith(q)) return 'handle';
  if (name.startsWith(q)) return 'name';
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 'name';
  if (handle.includes(q)) return 'handle';
  if (name.includes(q)) return 'name';
  return 'major';
}

export function searchUsers(viewer: AuthedUser, input: SearchInput): DiscoverSearchResponse {
  const q = normalizeQuery(input.q);
  if (q.length === 0) return { items: [], nextCursor: null };

  const vis = visibleUsersSql(viewer.id, 'u');
  const like = `%${escapeLike(q.toLowerCase())}%`;
  const prefix = `${escapeLike(q.toLowerCase())}%`;
  const conds = [
    vis.sql,
    "(lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(u.major,'')) LIKE ? ESCAPE '\\')",
  ];
  const params: unknown[] = [...vis.params, like, like, like];
  if (input.type === 'people') conds.push("u.account_type = 'student'");
  else if (input.type === 'orgs') conds.push("u.account_type = 'org'");

  const cur = decodeCursor(input.cursor);
  const ks = keysetWhere('c.k', 'c.id', cur, 'asc');
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT u.id, u.handle, u.display_name, u.major, u.university_id,
                (CASE WHEN u.university_id = ? THEN 0 ELSE 1 END) * 100000000000
                + (CASE WHEN lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\' THEN 0
                        WHEN lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\' THEN 1
                        ELSE 2 END) * 10000000000
                + (9999999999 - MIN(u.follower_count, 9999999999)) AS k
           FROM users u
          WHERE ${conds.join(' AND ')}
       ) c
       WHERE ${ks.sql}
       ORDER BY c.k ASC, c.id ASC
       LIMIT ?`,
    )
    .all(viewer.universityId, prefix, prefix, like, like, ...params, ...ks.params, input.limit + 1) as SearchRow[];

  const users = new Map<Id, UserListItem>();
  for (const it of userListItemsByIds(rows.slice(0, input.limit).map((r) => r.id), viewer.id)) users.set(it.id, it);

  const page = paginate(
    rows,
    input.limit,
    (r) => ({ k: r.k, id: r.id }),
    (r): SearchHit | null => {
      const user = users.get(r.id);
      if (!user) return null;
      return { user, matched: matchKind(r, q), sameCampus: r.university_id === viewer.universityId };
    },
  );
  return { items: page.items.filter((h): h is SearchHit => h !== null), nextCursor: page.nextCursor };
}

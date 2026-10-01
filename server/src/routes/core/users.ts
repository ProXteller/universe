/**
 * Foundation endpoints #21–#24, #27–#28 (SPEC §4.3): user search, public profiles, follow lists, campus.
 * Every list applies the block filter in SQL and hides non-active users (safety §7.1).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { CampusPlace, Paginated, PublicUser, University, UserListItem, UserSearchQuery } from '@shared/core';
import { db, prep } from '../../db/index';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { trackEvent } from '../../lib/analytics';
import { assertVisibleUser, sqlNotBlocked } from '../../lib/graph';
import { asyncHandler, decodeCursor, encodeCursor, noStore, pageQuery, typed, validate } from '../../lib/http';
import { enforceRateLimit } from '../../lib/rateLimit';
import { getUniversity, getUserByHandle, toPublicUser, userListItemsByIds, type UserRow } from '../../lib/users';

const router = Router();
const onboarded = [requireAuth, requireOnboarded];

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Users the viewer may see in any public list: active, not hidden campus, no block either way.
 * `alias` is the users table alias in the caller's query.
 */
function visibleUsersSql(viewerId: string, alias: string): { sql: string; params: string[] } {
  const nb = sqlNotBlocked(viewerId, `${alias}.id`);
  return {
    sql: `${alias}.status = 'active' AND ${nb.sql} AND NOT EXISTS (SELECT 1 FROM universities hu WHERE hu.id = ${alias}.university_id AND hu.is_hidden = 1)`,
    params: nb.params,
  };
}

/* #21 GET /users/search?q&type&scope&cursor&limit */
router.get(
  '/users/search',
  ...onboarded,
  validate({
    query: pageQuery.extend({
      q: z.string().trim().max(80).default(''),
      type: z.enum(['all', 'student', 'org']).default('all'),
      scope: z.enum(['campus', 'global']).default('global'),
    }),
  }),
  asyncHandler((req, res) => {
    const viewer = req.user!;
    const { query } = typed<unknown, Required<Pick<UserSearchQuery, 'q' | 'type' | 'scope'>> & { cursor?: string; limit: number }>(req);
    noStore(res);
    const q = query.q.replace(/^@/, '');
    if (q.length === 0) {
      const empty: Paginated<UserListItem> = { items: [], nextCursor: null };
      res.json(empty);
      return;
    }
    enforceRateLimit(viewer, 'search');
    const cur = decodeCursor(query.cursor);
    const offset = cur && typeof cur.k === 'number' ? cur.k : 0;
    const vis = visibleUsersSql(viewer.id, 'u');
    const like = `%${escapeLike(q.toLowerCase())}%`;
    const prefix = `${escapeLike(q.toLowerCase())}%`;
    const conds = [vis.sql, "(lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\' OR lower(COALESCE(u.major,'')) LIKE ? ESCAPE '\\')"];
    const params: unknown[] = [...vis.params, like, like, like];
    if (query.type !== 'all') {
      conds.push('u.account_type = ?');
      params.push(query.type);
    }
    if (query.scope === 'campus') {
      conds.push('u.university_id = ?');
      params.push(viewer.universityId);
    }
    const rows = db
      .prepare(
        `SELECT u.id FROM users u WHERE ${conds.join(' AND ')}
          ORDER BY (u.university_id = ?) DESC,
                   (lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\') DESC,
                   u.follower_count DESC, u.id
          LIMIT ? OFFSET ?`,
      )
      .all(...params, viewer.universityId, prefix, prefix, query.limit + 1, offset) as { id: string }[];
    const page = rows.slice(0, query.limit);
    const items = userListItemsByIds(page.map((r) => r.id), viewer.id);
    trackEvent('search', { userId: viewer.id, universityId: viewer.universityId }, { type: query.type, scope: query.scope, results: items.length });
    const out: Paginated<UserListItem> = {
      items,
      nextCursor: rows.length > query.limit ? encodeCursor({ k: offset + query.limit, id: page[page.length - 1]?.id ?? '' }) : null,
    };
    res.json(out);
  }),
);

function profileResponse(row: UserRow, viewerId: string): PublicUser {
  return toPublicUser(row, viewerId);
}

/* #23 GET /users/by-id/:id — before /users/:handle so 'by-id' never matches as a handle */
router.get(
  '/users/by-id/:id',
  ...onboarded,
  asyncHandler((req, res) => {
    const viewer = req.user!;
    const row = assertVisibleUser(viewer.id, req.params.id);
    noStore(res);
    trackEvent('profile_view', { userId: viewer.id, universityId: viewer.universityId }, { self: row.id === viewer.id });
    res.json(profileResponse(row, viewer.id));
  }),
);

/* #24 GET /users/:id/followers · /following ?cursor&limit&q */
for (const dir of ['followers', 'following'] as const) {
  router.get(
    `/users/:id/${dir}`,
    ...onboarded,
    validate({ query: pageQuery.extend({ q: z.string().trim().max(80).default('') }) }),
    asyncHandler((req, res) => {
      const viewer = req.user!;
      const target = assertVisibleUser(viewer.id, req.params.id);
      const { query } = typed<unknown, { cursor?: string; limit: number; q: string }>(req);
      const cur = decodeCursor(query.cursor);
      const vis = visibleUsersSql(viewer.id, 'u');
      const [selfCol, otherCol] = dir === 'followers' ? ['followee_id', 'follower_id'] : ['follower_id', 'followee_id'];
      const conds = [`f.${selfCol} = ?`, vis.sql];
      const params: unknown[] = [target.id, ...vis.params];
      if (query.q) {
        const like = `%${escapeLike(query.q.replace(/^@/, '').toLowerCase())}%`;
        conds.push("(lower(u.handle) LIKE ? ESCAPE '\\' OR lower(u.display_name) LIKE ? ESCAPE '\\')");
        params.push(like, like);
      }
      if (cur) {
        conds.push('(f.created_at < ? OR (f.created_at = ? AND u.id < ?))');
        params.push(cur.k, cur.k, cur.id);
      }
      const rows = db
        .prepare(`SELECT u.id, f.created_at AS at FROM follows f JOIN users u ON u.id = f.${otherCol} WHERE ${conds.join(' AND ')} ORDER BY f.created_at DESC, u.id DESC LIMIT ?`)
        .all(...params, query.limit + 1) as { id: string; at: number }[];
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      noStore(res);
      const out: Paginated<UserListItem> = {
        items: userListItemsByIds(page.map((r) => r.id), viewer.id),
        nextCursor: rows.length > query.limit && last ? encodeCursor({ k: last.at, id: last.id }) : null,
      };
      res.json(out);
    }),
  );
}

/* #22 GET /users/:handle */
router.get(
  '/users/:handle',
  ...onboarded,
  asyncHandler((req, res) => {
    const viewer = req.user!;
    const byHandle = getUserByHandle(req.params.handle);
    const row = assertVisibleUser(viewer.id, byHandle?.id ?? '');
    noStore(res);
    trackEvent('profile_view', { userId: viewer.id, universityId: viewer.universityId }, { self: row.id === viewer.id });
    res.json(profileResponse(row, viewer.id));
  }),
);

/* #27 GET /universities/me */
router.get(
  '/universities/me',
  ...onboarded,
  asyncHandler((req, res) => {
    noStore(res);
    const out: University = getUniversity(req.user!.universityId);
    res.json(out);
  }),
);

/* #28 GET /universities/me/places?kind= */
router.get(
  '/universities/me/places',
  ...onboarded,
  validate({ query: z.object({ kind: z.enum(['meetup', 'neighborhood', 'venue']).optional() }) }),
  asyncHandler((req, res) => {
    const { query } = typed<unknown, { kind?: CampusPlace['kind'] }>(req);
    const rows = (
      query.kind
        ? prep('SELECT id, kind, name FROM campus_places WHERE university_id = ? AND kind = ? ORDER BY sort, name').all(req.user!.universityId, query.kind)
        : prep('SELECT id, kind, name FROM campus_places WHERE university_id = ? ORDER BY kind, sort, name').all(req.user!.universityId)
    ) as CampusPlace[];
    const out: Paginated<CampusPlace> = { items: rows, nextCursor: null };
    res.json(out);
  }),
);

export default router;

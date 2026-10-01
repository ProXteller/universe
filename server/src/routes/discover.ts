/**
 * `discover` slice router — mounted at `/api/discover` by foundation with `requireAuth + requireOnboarded`
 * (SPEC §4.3); this file adds neither. Endpoints (SPEC §5.5):
 *   GET  /home               → DiscoverHome
 *   POST /dismiss            → 204
 *   GET  /search?q&type&cursor&limit → Paginated<SearchHit>
 * Profile, follow lists, follow, block and edit profile are foundation endpoints (#10, #22–#26).
 * No import-time DB access (R4): every statement is prepared lazily inside the services.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { DiscoverSearchType, DismissSuggestionRequest } from '@shared/discover';
import { SUGGESTION_SECTIONS } from '@shared/discover';
import { trackEvent } from '../lib/analytics';
import { asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { enforceRateLimit } from '../lib/rateLimit';
import { dismissSuggestion } from '../services/discover/dismiss';
import { discoverHome } from '../services/discover/home';
import { normalizeQuery, searchUsers } from '../services/discover/search';

const router = Router();

/* GET /home */
router.get(
  '/home',
  asyncHandler((req, res) => {
    noStore(res);
    res.json(discoverHome(req.user!));
  }),
);

/* POST /dismiss { userId, section } → 204 */
router.post(
  '/dismiss',
  validate({
    body: z.object({
      userId: z.string().trim().min(1).max(64),
      section: z.enum(SUGGESTION_SECTIONS as [string, ...string[]]),
    }),
  }),
  asyncHandler((req, res) => {
    const { body } = typed<DismissSuggestionRequest>(req);
    dismissSuggestion(req.user!, body.userId, body.section);
    res.status(204).end();
  }),
);

/* GET /search?q&type=all|people|orgs&cursor&limit */
router.get(
  '/search',
  validate({
    query: pageQuery.extend({
      q: z.string().max(80).default(''),
      type: z.enum(['all', 'people', 'orgs']).default('all'),
    }),
  }),
  asyncHandler((req, res) => {
    const viewer = req.user!;
    const { query } = typed<unknown, { q: string; type: DiscoverSearchType; cursor?: string; limit: number }>(req);
    noStore(res);
    const q = normalizeQuery(query.q);
    if (q.length === 0) {
      res.json({ items: [], nextCursor: null });
      return;
    }
    enforceRateLimit(viewer, 'search');
    const out = searchUsers(viewer, { q, type: query.type, cursor: query.cursor, limit: query.limit });
    if (!query.cursor) {
      trackEvent('search', { userId: viewer.id, universityId: viewer.universityId }, { surface: 'discover', type: query.type, results: out.items.length });
    }
    res.json(out);
  }),
);

export default router;

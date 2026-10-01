/**
 * Foundation endpoints #31–#32 (SPEC §4.3): notification list + mark read.   LANE S-M2b owns this file.
 *
 * #31 runs the lazy notification hooks first (campus reminders, roommate "still looking", buzz poll closed), then
 * returns a keyset page (newest first) filtered by `NOTIFICATION_FILTERS[filter]` plus the viewer's `unreadCount`.
 * #32 marks the given ids (or everything) read and returns the fresh `Badges` (also pushed over ws so other tabs sync).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Badges, MarkNotificationsReadRequest, NotificationFilter, NotificationListResponse } from '@shared/core';
import { NOTIFICATION_FILTERS } from '@shared/core';
import { requireAuth, requireOnboarded } from '../../middleware/auth';
import { asyncHandler, decodeCursor, noStore, pageQuery, paginate, typed, validate } from '../../lib/http';
import { badgesFor, currentBadges, listNotificationRows, markNotificationsRead, runNotificationHooks, serializeNotifications } from '../../lib/notify';
import { publishToUser } from '../../lib/realtime';

const router = Router();
const onboarded = [requireAuth, requireOnboarded];
const filters = Object.keys(NOTIFICATION_FILTERS) as [NotificationFilter, ...NotificationFilter[]];

router.get(
  '/notifications',
  ...onboarded,
  validate({ query: pageQuery.extend({ filter: z.enum(filters).default('all') }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { query } = typed<unknown, { filter: NotificationFilter; cursor?: string; limit: number }>(req);
    runNotificationHooks(user.id);
    const categories = NOTIFICATION_FILTERS[query.filter];
    const rows = listNotificationRows(user.id, categories, decodeCursor(query.cursor), query.limit + 1);
    const page = paginate(rows, query.limit, (r) => ({ k: r.created_at, id: r.id }), (r) => r);
    const out: NotificationListResponse = {
      items: serializeNotifications(page.items),
      nextCursor: page.nextCursor,
      unreadCount: currentBadges(user.id).notifications,
    };
    res.json(out);
  }),
);

router.post(
  '/notifications/read',
  ...onboarded,
  validate({ body: z.object({ ids: z.union([z.literal('all'), z.array(z.string().min(1).max(64)).max(200)]).optional() }) }),
  asyncHandler((req, res) => {
    noStore(res);
    const user = req.user!;
    const { body } = typed<MarkNotificationsReadRequest>(req);
    const changed = markNotificationsRead(user.id, body.ids);
    const out: Badges = badgesFor(user.id);
    if (changed > 0) publishToUser(user.id, { type: 'badges', badges: out });
    res.json(out);
  }),
);

export default router;

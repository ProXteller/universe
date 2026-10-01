/**
 * The campus slice's registrations with foundation (SPEC §4.2.10 / §5.9): the `event` ContentAdapter (reports,
 * auto-hide, the staff queue and removal work without touching campus tables), the `event` + `course` card resolvers,
 * the lazy event-reminder notification hook, and the `campus.events` rule pack (safety §7.7: "girls free"-type
 * targeting on event descriptions → FLAG visible). Pure registry writes at import time — no DB (R4).
 */
import type { ContentStatus, Id } from '@shared/core';
import { prep, tx } from '../../db/index';
import { now } from '../../lib/clock';
import { registerCardResolver, registerContentAdapter, type ContentSnapshot } from '../../lib/content';
import { registerRulePack, type RulePack } from '../../lib/moderation/index';
import { registerNotificationHook, removeNotificationsFor } from '../../lib/notify';
import { getUserRow, markPublicActivity, unmarkPublicActivity } from '../../lib/users';
import { getCourseRow, serializeCourse } from './courses';
import { formatEventWhen, generateEventReminders, getEventRow } from './events';

type AdapterStatus = Extract<ContentStatus, 'active' | 'hidden' | 'removed'>;

function eventSnapshot(id: Id): ContentSnapshot | null {
  const row = getEventRow(id);
  if (!row) return null;
  return {
    entityType: 'event',
    entityId: row.id,
    authorId: row.host_id,
    universityId: row.university_id,
    status: row.status,
    surface: 'event',
    anon: false,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: 'event',
    fields: [
      { field: 'title', text: row.title },
      ...(row.description ? [{ field: 'body', text: row.description }] : []),
      { field: 'name', text: row.location_name },
      ...(row.address ? [{ field: 'address', text: row.address }] : []),
    ],
    media: row.cover_url.startsWith('/uploads/') ? [{ url: row.cover_url, kind: 'image' as const }] : [],
    href: `/campus/events/${row.id}`,
    parent: null,
  };
}

function setEventStatus(id: Id, status: AdapterStatus, opts?: { immune?: boolean }): void {
  const row = getEventRow(id);
  if (!row || row.status === 'deleted') return;
  tx(() => {
    prep('UPDATE events SET status = ?, auto_hide_immune = CASE WHEN ? THEN 1 ELSE auto_hide_immune END, updated_at = ? WHERE id = ?').run(
      status, opts?.immune ? 1 : 0, now(), id,
    );
    if (status === 'active' && row.cancelled_at === null) markPublicActivity(row.host_id, 'event', id, row.created_at);
    else unmarkPublicActivity('event', id);
    if (status === 'removed') removeNotificationsFor({ entityType: 'event', entityId: id });
  });
}

/** Safety §7.7 events rules (owner: campus). Medium harassment on a PUBLIC surface → FLAG visible (§2.5). */
const EVENTS_PACK: RulePack = {
  id: 'campus.events',
  version: '1.0.0',
  rules: [
    {
      id: 'evt.gender_targeting.v1',
      category: 'harassment_bullying',
      subcode: 'event_targeting',
      severity: 'medium',
      kind: 'term',
      view: ['folded', 'spaced'],
      surfaces: ['event'],
      terms: [
        'girls free', 'girls get in free', 'girls drink free', 'girls no cover', 'free for girls', 'free entry for girls', 'girls in free',
        'ladies free', 'ladies get in free', 'ladies drink free', 'ladies no cover', 'free for ladies', 'free entry for ladies', 'ladies in free',
        'females free', 'free for females', 'girls only free', 'no cover for girls', 'no cover for ladies', 'girls dont pay', "girls don't pay",
        'ladies dont pay', "ladies don't pay",
      ],
      guards: ['no gender', 'everyone free', 'everybody free', 'free for everyone', 'free for all', 'all genders'],
    },
  ],
};

/** Called once from the router module (import time). Idempotent: registries are last-write-wins. */
export function registerCampus(): void {
  registerContentAdapter({ entityType: 'event', load: eventSnapshot, setStatus: setEventStatus });

  registerCardResolver('event', (id, viewerId) => {
    const row = getEventRow(id);
    if (!row) return null;
    if (row.status !== 'active' && !(row.host_id === viewerId && row.status !== 'deleted')) return null;
    // Events are campus-only: an off-campus viewer gets "No longer available" (same rule as loadVisibleEvent).
    if (row.host_id !== viewerId && getUserRow(viewerId)?.university_id !== row.university_id) return null;
    const host = getUserRow(row.host_id);
    if (!host || host.status !== 'active') return null;
    const at = now();
    const status = row.cancelled_at !== null ? 'cancelled' : row.ends_at <= at ? 'ended' : 'available';
    return {
      title: row.title,
      subtitle: `${formatEventWhen(row.starts_at)} · ${row.location_name}`,
      imageUrl: row.cover_url,
      href: `/campus/events/${row.id}`,
      status,
      price: null,
      badge: row.free_food === 1 ? 'Free food' : null,
      ownerId: row.host_id,
      meetupSpot: null,
    };
  });

  // The link reveals only the code + campus: a viewer from another campus gets "No longer available".
  registerCardResolver('course', (id, viewerId) => {
    const row = getCourseRow(id);
    if (!row) return null;
    const viewer = getUserRow(viewerId);
    if (!viewer || viewer.university_id !== row.university_id) return null;
    const course = serializeCourse(row, viewerId);
    return {
      title: row.code,
      subtitle: `${row.title} · ${row.term}`,
      imageUrl: null,
      href: `/c/${row.id}`,
      status: 'available',
      price: null,
      badge: `${course.memberCount} ${course.memberCount === 1 ? 'classmate' : 'classmates'}`,
      ownerId: null,
      meetupSpot: null,
    };
  });

  registerNotificationHook('campus.event_reminder', generateEventReminders);
  registerRulePack(EVENTS_PACK);
}

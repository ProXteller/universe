/**
 * Registrations the router performs at import time (R4 — pure: no DB access until a callback runs):
 *  - ContentAdapters `buzz` / `buzz_reply` (`anon: true`, `staffContext` through the blind serializer, `setLocked`)
 *  - CardResolver `buzz` (text snippet + "Buzz · {shortName}", `ownerId: null`, `imageUrl: null`; status only)
 *  - Notification hook: close due polls → `buzz.poll_closed` (lazy, per viewer)
 * Buzz NEVER calls markPublicActivity / unmarkPublicActivity (Constitution §5.3).
 */
import type { ContentEntityType, Id } from '@shared/core';
import { prep, tx } from '../../db/index';
import { now } from '../../lib/clock';
import { registerCardResolver, registerContentAdapter, type ContentAdapter, type ContentSnapshot } from '../../lib/content';
import { log } from '../../lib/logger';
import { notifyAnonymous, registerNotificationHook, removeNotificationsFor } from '../../lib/notify';
import { blindStaffContext, headline, snippet } from './serialize';
import { registerBuzzSchemaUpgrade } from './schema';
import { campusShortNames, getPost, parseMedia, recountReplies, setPostStatus, type BuzzRow } from './store';
import { threadHref } from './votes';

function entityTypeOf(row: BuzzRow): ContentEntityType {
  return row.root_id === null ? 'buzz' : 'buzz_reply';
}

function snapshot(row: BuzzRow): ContentSnapshot {
  const isRoot = row.root_id === null;
  const optionTexts = isRoot
    ? (prep('SELECT text FROM buzz_poll_options WHERE post_id = ? ORDER BY idx').all(row.id) as { text: string }[]).map((o) => o.text)
    : [];
  return {
    entityType: entityTypeOf(row),
    entityId: row.id,
    authorId: row.author_id,
    universityId: row.university_id,
    status: row.status,
    surface: isRoot ? 'buzz' : 'buzz_reply',
    anon: true,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: isRoot ? 'buzz' : 'reply',
    fields: [
      ...(isRoot && row.title ? [{ field: 'title', text: row.title }] : []),
      { field: 'body', text: row.text },
      ...optionTexts.map((text) => ({ field: 'option', text })),
    ],
    media: isRoot ? parseMedia(row.media).map((m) => ({ url: m.url, kind: m.type })) : [],
    href: threadHref(row.root_id ?? row.id),
    parent: isRoot ? null : { entityType: row.parent_id === row.root_id ? 'buzz' : 'buzz_reply', entityId: row.parent_id ?? row.root_id! },
  };
}

function makeAdapter(entityType: 'buzz' | 'buzz_reply'): ContentAdapter {
  return {
    entityType,
    load(id) {
      const row = getPost(id);
      if (!row || entityTypeOf(row) !== entityType) return null;
      return snapshot(row);
    },
    setStatus(id, status, opts) {
      const row = getPost(id);
      if (!row || entityTypeOf(row) !== entityType) return;
      tx(() => {
        setPostStatus(id, status, { immune: opts?.immune });
        if (row.root_id) recountReplies(row.root_id);
        if (status === 'removed') removeNotificationsFor({ entityType, entityId: id });
      });
    },
    staffContext(id) {
      try {
        return blindStaffContext(id);
      } catch (err) {
        log.error('buzz staffContext failed', err);
        return null;
      }
    },
    ...(entityType === 'buzz'
      ? {
          setLocked(id: Id, locked: boolean) {
            prep('UPDATE buzz_posts SET locked = ? WHERE id = ? AND root_id IS NULL').run(locked ? 1 : 0, id);
          },
        }
      : {}),
  };
}

/** Lazy `buzz.poll_closed`: runs before the viewer's notification list / badges; only that viewer's polls. */
function closeDuePolls(userId: Id): void {
  const at = now();
  const due = prep(
    `SELECT p.id, p.author_id FROM buzz_polls pl JOIN buzz_posts p ON p.id = pl.post_id
      WHERE p.author_id = ? AND pl.closes_at <= ? AND pl.closed_notified = 0 AND p.status != 'deleted'`,
  ).all(userId, at) as { id: Id; author_id: Id }[];
  for (const poll of due) {
    const votes = (prep('SELECT COUNT(*) AS n FROM buzz_poll_votes WHERE post_id = ?').get(poll.id) as { n: number }).n;
    prep('UPDATE buzz_polls SET closed_notified = 1 WHERE post_id = ?').run(poll.id);
    notifyAnonymous({ userId: poll.author_id, type: 'buzz.poll_closed', threadId: poll.id, href: threadHref(poll.id), data: { votes } });
  }
}

let registered = false;

/** Idempotent; called by the router module at import time. */
export function registerBuzz(): void {
  if (registered) return;
  registered = true;
  registerBuzzSchemaUpgrade();
  registerContentAdapter(makeAdapter('buzz'));
  registerContentAdapter(makeAdapter('buzz_reply'));
  registerCardResolver('buzz', (id) => {
    const row = getPost(id);
    // status only — never a block / follow rule (safety L14); a non-active buzz is simply "No longer available"
    if (!row || row.root_id !== null || row.status !== 'active') return null;
    // a small campus is never named next to a buzz (L18): its anonymity set could be a single person
    const campus = campusShortNames([row.university_id]).get(row.university_id);
    return {
      title: snippet(headline(row), 100),
      subtitle: campus ? `Buzz · ${campus}` : 'Buzz',
      imageUrl: null,
      href: threadHref(row.id),
      status: 'available',
      price: null,
      badge: null,
      ownerId: null,
      meetupSpot: null,
    };
  });
  registerNotificationHook('buzz', closeDuePolls);
}

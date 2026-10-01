/**
 * The orbit slice's registrations with foundation (SPEC §4.2.10): ContentAdapters for `orbit_post` / `orbit_comment`
 * (reports, auto-hide, the staff queue and removal work through these without touching orbit tables) and the `post`
 * card resolver (share sheet, chat cards, `GET /cards/post/:id`). Pure registry writes at import time — no DB (R4).
 */
import type { ContentStatus, Id } from '@shared/core';
import { prep, tx } from '../../db/index';
import { registerCardResolver, registerContentAdapter, type ContentSnapshot } from '../../lib/content';
import { now } from '../../lib/clock';
import { removeNotificationsFor } from '../../lib/notify';
import { getUserRow, markPublicActivity, unmarkPublicActivity } from '../../lib/users';
import { applyCommentCounters, getCommentRow } from './comments';
import { getPostRow, postImages, purgePostNotifications, snippetOf } from './posts';

type AdapterStatus = Extract<ContentStatus, 'active' | 'hidden' | 'removed'>;

function postSnapshot(id: Id): ContentSnapshot | null {
  const row = getPostRow(id);
  if (!row) return null;
  const options = prep('SELECT text FROM orbit_poll_options WHERE post_id = ? ORDER BY idx').all(id) as { text: string }[];
  return {
    entityType: 'orbit_post',
    entityId: row.id,
    authorId: row.author_id,
    universityId: row.university_id,
    status: row.status,
    surface: 'orbit_post',
    anon: false,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: 'post',
    fields: [...(row.text ? [{ field: 'body', text: row.text }] : []), ...options.map((o) => ({ field: 'option', text: o.text }))],
    media: postImages(row).map((i) => ({ url: i.url, kind: 'image' as const })),
    href: `/post/${row.id}`,
    parent: null,
  };
}

function setPostStatus(id: Id, status: AdapterStatus, opts?: { immune?: boolean }): void {
  const row = getPostRow(id);
  if (!row || row.status === 'deleted') return;
  tx(() => {
    prep('UPDATE orbit_posts SET status = ?, auto_hide_immune = CASE WHEN ? THEN 1 ELSE auto_hide_immune END, updated_at = ? WHERE id = ?').run(
      status, opts?.immune ? 1 : 0, now(), id,
    );
    if (status === 'active') markPublicActivity(row.author_id, 'post', id, row.created_at);
    else unmarkPublicActivity('post', id);
    if (status === 'removed') purgePostNotifications(id);
  });
}

function commentSnapshot(id: Id): ContentSnapshot | null {
  const row = getCommentRow(id);
  if (!row) return null;
  const post = getPostRow(row.post_id);
  return {
    entityType: 'orbit_comment',
    entityId: row.id,
    authorId: row.author_id,
    universityId: post?.university_id ?? getUserRow(row.author_id)?.university_id ?? '',
    status: row.status,
    surface: 'comment',
    anon: false,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: row.parent_id ? 'reply' : 'comment',
    fields: [{ field: 'body', text: row.text }],
    media: [],
    href: `/post/${row.post_id}`,
    parent: { entityType: 'orbit_post', entityId: row.post_id },
  };
}

function setCommentStatus(id: Id, status: AdapterStatus, opts?: { immune?: boolean }): void {
  const row = getCommentRow(id);
  if (!row || row.status === 'deleted' || row.status === status) {
    if (row && opts?.immune) prep('UPDATE orbit_comments SET auto_hide_immune = 1 WHERE id = ?').run(id);
    return;
  }
  tx(() => {
    const wasActive = row.status === 'active';
    if (wasActive && status !== 'active') applyCommentCounters(id, -1);
    prep('UPDATE orbit_comments SET status = ?, auto_hide_immune = CASE WHEN ? THEN 1 ELSE auto_hide_immune END WHERE id = ?').run(
      status, opts?.immune ? 1 : 0, id,
    );
    if (!wasActive && status === 'active') applyCommentCounters(id, +1);
    if (status === 'removed') removeNotificationsFor({ entityType: 'orbit_comment', entityId: id });
  });
}

/** Called once from the router module (import time). Idempotent: registries are last-write-wins. */
export function registerOrbit(): void {
  registerContentAdapter({ entityType: 'orbit_post', load: postSnapshot, setStatus: setPostStatus });
  registerContentAdapter({ entityType: 'orbit_comment', load: commentSnapshot, setStatus: setCommentStatus });
  registerCardResolver('post', (id, viewerId) => {
    const row = getPostRow(id);
    if (!row) return null;
    if (row.status !== 'active' && !(row.author_id === viewerId && row.status !== 'deleted')) return null;
    const author = getUserRow(row.author_id);
    if (!author || author.status !== 'active') return null;
    const images = postImages(row);
    const kind = images.length > 0 ? 'Photo' : row.has_poll ? 'Poll' : 'Post';
    return {
      title: row.text ? snippetOf(row.text, 90) : `${kind} by @${author.handle}`,
      subtitle: `@${author.handle} · ${row.has_poll && row.text ? 'Poll' : 'Orbit'}`,
      imageUrl: images[0]?.url ?? null,
      href: `/post/${row.id}`,
      status: 'available',
      price: null,
      badge: null,
      ownerId: row.author_id,
      meetupSpot: null,
    };
  });
}

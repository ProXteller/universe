/**
 * The reels slice's registry entries (SPEC §4.2.10, §5.2): ContentAdapters for `reel` + `reel_comment` and the
 * `reel` card resolver. Registered once by the router at import time (R4) — pure registry writes, no DB access here.
 */
import type { Id } from '@shared/core';
import { registerCardResolver, registerContentAdapter, type ContentSnapshot } from '../../lib/content';
import { prep } from '../../db/index';
import { getCommentRow, setCommentStatus } from './comments';
import { getReelRow, reelHref, setReelStatus, type ReelRow } from './reels';

function reelSnapshot(row: ReelRow): ContentSnapshot {
  const media: ContentSnapshot['media'] = [{ url: row.video_url, kind: 'video' }];
  if (row.poster_url) media.push({ url: row.poster_url, kind: 'image' });
  return {
    entityType: 'reel',
    entityId: row.id,
    authorId: row.author_id,
    universityId: row.university_id,
    status: row.status,
    surface: 'reel_caption',
    anon: false,
    autoHideImmune: row.auto_hide_immune === 1,
    createdAt: row.created_at,
    label: 'reel',
    fields: [{ field: 'body', text: row.caption }],
    media,
    href: reelHref(row.id),
    parent: null,
  };
}

let registered = false;

/** Idempotent: the router calls it at import; tests re-importing the module get the same entries. */
export function registerReelsRegistry(): void {
  if (registered) return;
  registered = true;

  registerContentAdapter({
    entityType: 'reel',
    load(id: Id) {
      const row = getReelRow(id);
      return row ? reelSnapshot(row) : null;
    },
    setStatus(id, status, opts) {
      setReelStatus(id, status, opts);
    },
  });

  registerContentAdapter({
    entityType: 'reel_comment',
    load(id: Id) {
      const row = getCommentRow(id);
      if (!row) return null;
      const reel = getReelRow(row.reel_id);
      return {
        entityType: 'reel_comment',
        entityId: row.id,
        authorId: row.author_id,
        universityId: reel?.university_id ?? '',
        status: row.status,
        surface: 'comment',
        anon: false,
        autoHideImmune: row.auto_hide_immune === 1,
        createdAt: row.created_at,
        label: 'comment',
        fields: [{ field: 'body', text: row.text }],
        media: [],
        href: `${reelHref(row.reel_id)}?comments=1`,
        parent: { entityType: 'reel', entityId: row.reel_id },
      };
    },
    setStatus(id, status, opts) {
      setCommentStatus(id, status, opts);
    },
  });

  // Card: title = caption or "Reel by @handle", image = poster. Foundation applies the block + owner-status rules.
  registerCardResolver('reel', (id: Id, viewerId: Id) => {
    const row = getReelRow(id);
    if (!row || row.status !== 'active') return null;
    // A campus-only reel never leaves its campus (same rule as visibleReelSql).
    if (row.visibility !== 'global' && row.author_id !== viewerId) {
      const viewer = prep('SELECT university_id FROM users WHERE id = ?').get(viewerId) as { university_id: Id } | undefined;
      if (viewer?.university_id !== row.university_id) return null;
    }
    const author = prep('SELECT handle, university_id FROM users WHERE id = ?').get(row.author_id) as { handle: string; university_id: Id } | undefined;
    const uni = author ? (prep('SELECT short_name FROM universities WHERE id = ?').get(author.university_id) as { short_name: string } | undefined) : undefined;
    const handle = author?.handle ?? 'someone';
    return {
      title: row.caption.trim() || `Reel by @${handle}`,
      subtitle: `@${handle}${uni ? ` · ${uni.short_name}` : ''}`,
      imageUrl: row.poster_url,
      href: reelHref(row.id),
      status: 'available',
      price: null,
      badge: null,
      ownerId: row.author_id,
      meetupSpot: null,
    };
  });
}

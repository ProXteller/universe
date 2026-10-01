/**
 * `reels` seed (SPEC §5.2 Seeds, §7.5, DECISIONS D5).
 * 12 reels ↔ `/seed-media/reels/reel-01…12.webm` (8.0 s VP9 loops, 540×960), posters via `kit.art.nebulaSvg`.
 * Authors: noahg ×3, tbrooks ×2, jordan_builds ×2, mayachen ×2 (reel_0009, reel_0010), solarcar ×1, rafacruz ×1 (NYU),
 * kaiyama ×1 (Stanford) = 10 hero-campus reels (7 global, 3 campus) + 2 global reels from other campuses.
 * Likes / views / comments come from background users + personas (power-law); every counter equals its rows;
 * `markPublicActivity` for each reel; Maya gets ONE collapsed `reel.like` (13 actors, read) + ONE unread `reel.comment`.
 * Deterministic: `kit.rng` only.
 */
import type { EpochMs, Id } from '@shared/core';
import type { SeedKit, SeedUser } from '../../lib/seedKit';
import { markPublicActivity } from '../../lib/users';
import { U } from './ids';

interface ReelSpec {
  n: number;
  author: string;
  visibility: 'campus' | 'global';
  caption: string;
  glyph: string;
  /** Popularity rank (0 = most liked) for the power-law. */
  rank: number;
  /** Recency order (0 = newest). */
  order: number;
}

/** Scenes in file order (D5): aurora, orbits, bokeh, constellation, sunrise, neon-grid, liquid, confetti, equalizer, court, rain, warp. */
const SPECS: readonly ReelSpec[] = [
  { n: 1, author: 'noahg', visibility: 'global', caption: 'Shot the sky over the 40 Acres at 2am. No filter, no sleep.', glyph: 'camera', rank: 0, order: 1 },
  { n: 2, author: 'jordan_builds', visibility: 'global', caption: 'Every sensor on the solar car, mapped as an orbit. Nerd art.', glyph: 'code', rank: 4, order: 6 },
  { n: 3, author: 'tbrooks', visibility: 'campus', caption: 'Dorm ramen upgrade. The bokeh is the sriracha.', glyph: 'coffee', rank: 6, order: 3 },
  { n: 4, author: 'noahg', visibility: 'global', caption: 'Connecting the dots between finals and sleep. Found none.', glyph: 'star', rank: 2, order: 9 },
  { n: 5, author: 'kaiyama', visibility: 'global', caption: 'Dish loop at sunrise. Worth the 5am alarm every single time.', glyph: 'sun', rank: 3, order: 8 },
  { n: 6, author: 'jordan_builds', visibility: 'campus', caption: 'Lab floor at 1am looks like Tron. The car is in there somewhere.', glyph: 'flask', rank: 8, order: 10 },
  { n: 7, author: 'solarcar', visibility: 'global', caption: 'New aero shell, fresh out of the mold. Race season is coming.', glyph: 'sparkle', rank: 5, order: 2 },
  { n: 8, author: 'tbrooks', visibility: 'campus', caption: 'Intramural win. Confetti was NOT allowed in the gym. Worth it.', glyph: 'trophy', rank: 9, order: 7 },
  { n: 9, author: 'mayachen', visibility: 'global', caption: 'Late-night study playlist, GDC 4th floor edition. Headphones on.', glyph: 'music', rank: 1, order: 0 },
  { n: 10, author: 'mayachen', visibility: 'global', caption: 'Pickup at Gregory. We lost. Vibes were immaculate.', glyph: 'ball', rank: 7, order: 4 },
  { n: 11, author: 'noahg', visibility: 'global', caption: 'Rain on the Tower. Turned the umbrella into a tripod.', glyph: 'film', rank: 10, order: 11 },
  { n: 12, author: 'rafacruz', visibility: 'global', caption: 'Subway to Tisch at warp speed. Every. Single. Morning.', glyph: 'mountain', rank: 11, order: 5 },
];

const COMMENTS: readonly string[] = [
  'this is so good',
  'okay the colors on this one',
  'need the playlist immediately',
  'where is this??',
  'teach me how you shot this',
  'the transition at the end is clean',
  'came back to watch it again',
  'campus looks unreal at night',
  'you win the week',
  'this needs sound on',
  'saving this for finals motivation',
  'the loop is seamless, how',
];

const REPLIES: readonly string[] = ['thank you!!', 'haha appreciate it', 'GDC, 4th floor by the windows', 'took like 40 tries', 'sound on is the only way'];

export default function seed(kit: SeedKit): void {
  const now = kit.now;
  // audience: every background user + persona + org; campus reels reach their own campus only
  const globalPool: SeedUser[] = [...kit.users.bg(), ...kit.users.personas, ...kit.users.orgs];

  const insertReel = kit.db.prepare(
    `INSERT INTO reels (id, author_id, university_id, caption, video_url, poster_url, duration_ms, width, height, visibility, status,
       like_count, comment_count, view_count, share_count, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,'active',0,0,0,0,?,?)`,
  );
  const insertLike = kit.db.prepare('INSERT OR IGNORE INTO reel_likes (reel_id, user_id, created_at) VALUES (?,?,?)');
  const insertView = kit.db.prepare('INSERT OR IGNORE INTO reel_views (reel_id, user_id, completed, first_viewed_at) VALUES (?,?,?,?)');
  const insertComment = kit.db.prepare(
    `INSERT INTO reel_comments (id, reel_id, author_id, parent_id, text, status, auto_hide_immune, like_count, reply_count, created_at)
     VALUES (?,?,?,?,?,'active',0,0,0,?)`,
  );
  const insertCommentLike = kit.db.prepare('INSERT OR IGNORE INTO reel_comment_likes (comment_id, user_id, created_at) VALUES (?,?,?)');
  const setCounts = kit.db.prepare('UPDATE reels SET like_count = ?, comment_count = ?, view_count = ? WHERE id = ?');
  const setReplyCount = kit.db.prepare('UPDATE reel_comments SET reply_count = ? WHERE id = ?');
  const setCommentLikes = kit.db.prepare('UPDATE reel_comments SET like_count = ? WHERE id = ?');

  let commentSeq = 0;
  const mayaId = U.mayachen;
  let mayaLikeDone = false;
  let mayaCommentDone = false;

  for (const spec of SPECS) {
    const author = kit.users.get(spec.author);
    const id = kit.id('reel', spec.n);
    const file = String(spec.n).padStart(2, '0');
    const createdAt = kit.spread(spec.order, SPECS.length);
    const poster = kit.art.writeSeedSvg(`reels/reel-${file}.svg`, kit.art.nebulaSvg({ seed: id, aspect: '9:16', glyph: spec.glyph }));

    insertReel.run(id, author.id, author.universityId, spec.caption, `/seed-media/reels/reel-${file}.webm`, poster, 8000, 540, 960, spec.visibility, createdAt, createdAt);
    markPublicActivity(author.id, 'reel', id, createdAt);

    // audience: campus reels reach the author's campus; global reels reach everyone
    const basePool = spec.visibility === 'campus' ? globalPool.filter((u) => u.universityId === author.universityId) : globalPool;
    const pool = basePool.filter((u) => u.id !== author.id);

    // power-law engagement: rank 0 ≈ 55 % of the pool, tail ≈ 8 %
    const share = Math.max(0.08, 0.55 / Math.pow(spec.rank + 1, 0.55));
    const likeTarget = Math.min(pool.length, Math.max(3, Math.round(pool.length * share)));
    const likers = kit.sample(pool, likeTarget);
    const likedAt = (i: number): EpochMs => Math.min(now - 60_000, createdAt + Math.round(((i + 1) / (likers.length + 1)) * Math.max(60_000, now - createdAt)));
    likers.forEach((u, i) => insertLike.run(id, u.id, likedAt(i)));

    // views ⊇ likes; every liker viewed, plus a slice of the rest
    const nonLikers = pool.filter((u) => !likers.some((l) => l.id === u.id));
    const extraViews = kit.sample(nonLikers, Math.min(nonLikers.length, Math.round(nonLikers.length * Math.min(0.9, share * 1.4))));
    const viewers: SeedUser[] = [...likers, ...extraViews];
    viewers.forEach((u, i) => insertView.run(id, u.id, kit.chance(0.62) ? 1 : 0, Math.min(now - 30_000, createdAt + 30_000 + i * 7_000)));

    // comments: 0–6 top-level from the audience, a few replies (often from the author)
    const commentTarget = Math.min(pool.length, Math.round(Math.max(0, 6 - spec.rank * 0.5)));
    const commenters = kit.sample(pool, commentTarget);
    const texts = kit.sample(COMMENTS, commenters.length);
    let commentCount = 0;
    commenters.forEach((u, i) => {
      commentSeq += 1;
      const cid = kit.id('rcm', commentSeq);
      const at = Math.min(now - 45_000, createdAt + 120_000 + i * 600_000);
      insertComment.run(cid, id, u.id, null, texts[i] ?? COMMENTS[0], at);
      commentCount += 1;
      // comment likes
      const clikers = kit.sample(pool.filter((p) => p.id !== u.id), kit.int(0, Math.min(4, pool.length - 1)));
      clikers.forEach((l, j) => insertCommentLike.run(cid, l.id, Math.min(now - 10_000, at + 30_000 + j * 5_000)));
      setCommentLikes.run(clikers.length, cid);
      // replies
      let replies = 0;
      if (kit.chance(0.45)) {
        commentSeq += 1;
        const rid = kit.id('rcm', commentSeq);
        const from = kit.chance(0.7) ? author : kit.pick(pool);
        insertComment.run(rid, id, from.id, cid, kit.pick(REPLIES), Math.min(now - 20_000, at + 300_000));
        replies += 1;
        commentCount += 1;
      }
      setReplyCount.run(replies, cid);

      // Maya's ONE unread `reel.comment` (the newest comment on her second reel)
      if (author.id === mayaId && spec.n === 10 && !mayaCommentDone && i === commenters.length - 1) {
        mayaCommentDone = true;
        kit.notify({
          userId: mayaId, type: 'reel.comment', actorId: u.id, href: `/reel/${id}?comments=1`, collapse: false,
          target: { entityType: 'reel_comment', entityId: cid }, thumbnailUrl: poster,
          data: { snippet: (texts[i] ?? COMMENTS[0]).slice(0, 80), commentId: cid }, createdAt: at, read: false,
        });
      }
    });

    setCounts.run(likers.length, commentCount, viewers.length, id);

    // Maya's ONE collapsed `reel.like` row: 13 likers of reel_0009, read (never 13 calls, never direct SQL)
    if (author.id === mayaId && spec.n === 9 && !mayaLikeDone) {
      mayaLikeDone = true;
      const actorIds: Id[] = likers.slice(0, 13).map((u) => u.id);
      kit.notify({
        userId: mayaId, type: 'reel.like', actorId: actorIds[actorIds.length - 1] ?? null, actorIds, href: `/reel/${id}`,
        target: { entityType: 'reel', entityId: id }, thumbnailUrl: poster, data: { caption: spec.caption.slice(0, 80) },
        createdAt: likedAt(Math.min(12, likers.length - 1)), read: true,
      });
    }
  }
}

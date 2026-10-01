/**
 * Orbit campus highlights (DECISIONS D8): the feed is follows ∪ self (any campus) ∪ popular / official posts from the
 * viewer's OWN campus by people they don't follow. Checks membership, the label, the campus-relative bar, the windows,
 * the safety exclusions (minors, brand-new and restricted accounts, blocks, reports, held, suspended), paging and the
 * "New posts" counter. Isolation mode, core seed only (so every campus starts empty).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@shared/core';
import type { Post } from '@shared/orbit';
import { DAY, HOUR, now, setNow } from '../src/lib/clock';
import { createTestApp, type TestCtx } from '../src/lib/testing';
import type { AuthedUser } from '../src/lib/users';
import { campusHighlightRule, HIGHLIGHT_MIN_SCORE } from '../src/services/orbit/posts';

let ctx: TestCtx;

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['orbit'] });
});
afterEach(() => setNow(null));

async function createPost(user: AuthedUser, text: string): Promise<Id> {
  const res = await ctx.as(user.id).post('/api/orbit/posts').send({ text });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as Id;
}

/** `n` real likes (rows + counter kept equal), from fresh same-campus accounts. */
function boost(postId: Id, n: number): void {
  const uni = (ctx.db.prepare('SELECT university_id AS u FROM orbit_posts WHERE id = ?').get(postId) as { u: Id }).u;
  const ins = ctx.db.prepare('INSERT INTO orbit_likes (post_id, user_id, created_at) VALUES (?,?,?)');
  for (let i = 0; i < n; i++) ins.run(postId, ctx.createUser({ universityId: uni }).id, now());
  ctx.db.prepare('UPDATE orbit_posts SET like_count = (SELECT COUNT(*) FROM orbit_likes WHERE post_id = ?) WHERE id = ?').run(postId, postId);
}

async function feed(user: AuthedUser, query = ''): Promise<{ items: Post[]; nextCursor: string | null }> {
  const res = await ctx.as(user.id).get(`/api/orbit/feed${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { items: Post[]; nextCursor: string | null };
}

async function find(user: AuthedUser, postId: Id): Promise<Post | undefined> {
  return (await feed(user, '?limit=50')).items.find((p) => p.id === postId);
}

describe('membership', () => {
  it('a popular post from your campus by someone you don\'t follow is in your feed, labelled "popular"; an ordinary one is not', async () => {
    const viewer = ctx.createUser();
    const author = ctx.createUser();
    const hot = await createPost(author, 'the free pizza line is wrapped around the building');
    const meh = await createPost(author, 'ordinary update');
    boost(hot, 12);
    const items = (await feed(viewer, '?limit=50')).items;
    const p = items.find((x) => x.id === hot);
    expect(p).toBeTruthy();
    expect(p!.highlight).toBe('popular');
    expect(p!.author.id).toBe(author.id); // a public post: the real profile, as everywhere in Orbit
    expect(items.map((x) => x.id)).not.toContain(meh);
  });

  it('other campuses: only people you follow — a popular post from another campus never shows', async () => {
    const viewer = ctx.createUser();
    const farFollowed = ctx.createUser({ universityId: 'uni_umich' });
    const farStranger = ctx.createUser({ universityId: 'uni_umich' });
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, farFollowed.id, now());
    const followedPost = await createPost(farFollowed, 'hello from Ann Arbor');
    const strangerPost = await createPost(farStranger, 'everyone in Ann Arbor loves this');
    boost(strangerPost, 40);
    const items = (await feed(viewer, '?limit=50')).items;
    const f = items.find((x) => x.id === followedPost);
    expect(f).toBeTruthy();
    expect(f!.highlight).toBeUndefined();
    expect(items.map((x) => x.id)).not.toContain(strangerPost);
  });

  it('your own and followed authors\' posts never carry a label, however popular', async () => {
    const viewer = ctx.createUser();
    const friend = ctx.createUser();
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, friend.id, now());
    const mine = await createPost(viewer, 'my post');
    const theirs = await createPost(friend, 'friend post');
    boost(mine, 30);
    boost(theirs, 30);
    const items = (await feed(viewer, '?limit=50')).items;
    expect(items.find((x) => x.id === mine)!.highlight).toBeUndefined();
    expect(items.find((x) => x.id === theirs)!.highlight).toBeUndefined();
  });

  it('following the author turns a highlight into an ordinary followed post; unfollowing brings the label back', async () => {
    const viewer = ctx.createUser();
    const author = ctx.createUser();
    const hot = await createPost(author, 'campus-wide question');
    boost(hot, 10);
    expect((await find(viewer, hot))!.highlight).toBe('popular');
    expect((await ctx.as(viewer.id).post(`/api/users/${author.id}/follow`)).status).toBe(200);
    expect((await find(viewer, hot))!.highlight).toBeUndefined();
    expect((await ctx.as(viewer.id).delete(`/api/users/${author.id}/follow`)).status).toBe(200);
    expect((await find(viewer, hot))!.highlight).toBe('popular');
  });

  it('a viewer who follows nobody still gets their campus\'s popular posts (no empty Orbit on day one)', async () => {
    const fresh = ctx.createUser();
    const author = ctx.createUser();
    const hot = await createPost(author, 'welcome week is wild');
    boost(hot, 9);
    const res = await feed(fresh);
    expect(res.items.map((p) => p.id)).toEqual([hot]);
    expect((await ctx.as(fresh.id).get('/api/orbit/feed')).body.followingCount).toBe(0);
  });
});

describe('the bar', () => {
  /** Engagement without the like rows (this block only reads the computed bar and the feed). */
  const setLikes = (id: Id, n: number): void => {
    ctx.db.prepare('UPDATE orbit_posts SET like_count = ? WHERE id = ?').run(n, id);
  };

  it('"popular" = more engagement than the campus\'s typical (median) post this week, and never below the floor', async () => {
    // a lively campus: 11 posts, median 20 → 21 needed
    const lively = 'uni_nyu';
    for (const s of [0, 0, 0, 20, 20, 20, 20, 20, 30, 40, 50]) setLikes(await createPost(ctx.createUser({ universityId: lively }), `lively ${s}`), s);
    expect(campusHighlightRule(lively).minScore).toBe(21);
    const viewer = ctx.createUser({ universityId: lively });
    const items = (await feed(viewer, '?limit=50')).items;
    expect(items).toHaveLength(3); // the 30, the 40 and the 50; the five at the median stay out
    expect(items.every((p) => p.highlight === 'popular')).toBe(true);

    // a quiet campus: median 0 → the floor (5) wins
    const quiet = 'uni_stanford';
    for (const s of [0, 0, 0, 0, 0, 0, 2, 4, 10, 20]) setLikes(await createPost(ctx.createUser({ universityId: quiet }), `quiet ${s}`), s);
    expect(campusHighlightRule(quiet).minScore).toBe(HIGHLIGHT_MIN_SCORE);
    expect((await feed(ctx.createUser({ universityId: quiet }), '?limit=50')).items).toHaveLength(2); // the 10 and the 20
  });

  it('with only a handful of posts this week there is no "typical" post: the floor alone applies', async () => {
    const uni = 'uni_utoronto';
    for (const s of [40, 40, 40]) setLikes(await createPost(ctx.createUser({ universityId: uni }), `few ${s}`), s);
    expect(campusHighlightRule(uni).minScore).toBe(HIGHLIGHT_MIN_SCORE);
  });

  it('comments weigh double and poll votes count half', async () => {
    const viewer = ctx.createUser();
    const talked = await createPost(ctx.createUser(), 'hot take about the library');
    ctx.db.prepare('UPDATE orbit_posts SET comment_count = 3 WHERE id = ?').run(talked); // 6 ≥ 5
    const quiet = await createPost(ctx.createUser(), 'two comments only');
    ctx.db.prepare('UPDATE orbit_posts SET comment_count = 2 WHERE id = ?').run(quiet); // 4 < 5
    const poll = await ctx.as(ctx.createUser().id).post('/api/orbit/posts').send({ text: 'best study spot?', poll: { options: ['PCL', 'Welch'] } });
    expect(poll.status, JSON.stringify(poll.body)).toBe(201);
    ctx.db.prepare('UPDATE orbit_poll_options SET vote_count = 5 WHERE post_id = ?').run(poll.body.id); // 10 votes → 5
    const items = (await feed(viewer, '?limit=50')).items;
    expect(items.find((p) => p.id === talked)?.highlight).toBe('popular');
    expect(items.find((p) => p.id === poll.body.id)?.highlight).toBe('popular');
    expect(items.map((p) => p.id)).not.toContain(quiet);
  });

  it('a post older than the 7-day window is not a highlight (it stays visible to followers)', async () => {
    const viewer = ctx.createUser();
    const follower = ctx.createUser();
    const author = ctx.createUser();
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(follower.id, author.id, now());
    setNow(now() - 8 * DAY);
    const old = await createPost(author, 'last week was a lot');
    setNow(null);
    boost(old, 50);
    expect(await find(viewer, old)).toBeUndefined();
    expect(await find(follower, old)).toBeTruthy();
  });
});

describe('official campus updates', () => {
  it('a verified campus org\'s post shows for 3 days without needing likes, labelled "official"; unverified orgs need to be popular', async () => {
    const viewer = ctx.createUser();
    const official = ctx.createUser({ accountType: 'org' });
    ctx.db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(official.id);
    const club = ctx.createUser({ accountType: 'org' });
    const news = await createPost(official, 'Registration deadline moved to Friday.');
    const clubPost = await createPost(club, 'Club meeting tonight');
    expect((await find(viewer, news))!.highlight).toBe('official');
    expect(await find(viewer, clubPost)).toBeUndefined();
    // a far-away verified org is still not your campus
    const farOfficial = ctx.createUser({ accountType: 'org', universityId: 'uni_umich' });
    ctx.db.prepare('UPDATE users SET is_verified = 1 WHERE id = ?').run(farOfficial.id);
    expect(await find(viewer, await createPost(farOfficial, 'Michigan news'))).toBeUndefined();
    // after 3 days an unliked official post drops out
    setNow(now() + 3 * DAY + HOUR);
    expect(await find(viewer, news)).toBeUndefined();
  });
});

describe('safety', () => {
  it('never pushes a minor\'s post, a brand-new account\'s post or a restricted account\'s post to non-followers', async () => {
    const viewer = ctx.createUser();
    const minor = ctx.createUser({ isAdult: false });
    const newbie = ctx.createUser({ createdAt: now() - 2 * HOUR });
    const restricted = ctx.createUser();
    ctx.db.prepare('UPDATE users SET restricted_until = ? WHERE id = ?').run(now() + DAY, restricted.id);
    const ids = [await createPost(minor, 'minor post'), await createPost(newbie, 'newbie post'), await createPost(restricted, 'restricted post')];
    for (const id of ids) boost(id, 25);
    const seen = (await feed(viewer, '?limit=50')).items.map((p) => p.id);
    for (const id of ids) expect(seen).not.toContain(id);
    // their followers still see them
    const follower = ctx.createUser({ follows: [minor.id, newbie.id, restricted.id] });
    const theirs = (await feed(follower, '?limit=50')).items.map((p) => p.id);
    for (const id of ids) expect(theirs).toContain(id);
  });

  it('blocks (both ways), reports, held posts and suspended authors keep a popular post out', async () => {
    const viewer = ctx.createUser();
    const blockedByViewer = ctx.createUser();
    const blockerOfViewer = ctx.createUser();
    const reported = ctx.createUser();
    const heldAuthor = ctx.createUser();
    const suspended = ctx.createUser();
    const a = await createPost(blockedByViewer, 'a');
    const b = await createPost(blockerOfViewer, 'b');
    const c = await createPost(reported, 'c');
    const d = await createPost(heldAuthor, 'd');
    const e = await createPost(suspended, 'e');
    for (const id of [a, b, c, d, e]) boost(id, 25);
    expect((await feed(viewer, '?limit=50')).items.map((p) => p.id)).toEqual(expect.arrayContaining([a, b, c, d, e]));

    expect((await ctx.as(viewer.id).post(`/api/users/${blockedByViewer.id}/block`)).status).toBe(200);
    expect((await ctx.as(blockerOfViewer.id).post(`/api/users/${viewer.id}/block`)).status).toBe(200);
    expect((await ctx.as(viewer.id).post('/api/reports').send({ entityType: 'orbit_post', entityId: c, reason: 'spam_scam' })).status).toBe(200);
    ctx.db.prepare("UPDATE orbit_posts SET status = 'held' WHERE id = ?").run(d);
    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(suspended.id);

    const seen = (await feed(viewer, '?limit=50')).items.map((p) => p.id);
    for (const id of [a, b, c, d, e]) expect(seen).not.toContain(id);
  });
});

describe('paging and the "New posts" counter', () => {
  it('highlights are interleaved strictly by time; pages never repeat or skip', async () => {
    const viewer = ctx.createUser();
    const friend = ctx.createUser();
    const stranger = ctx.createUser();
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, friend.id, now());
    const base = now() - HOUR;
    const expected: Id[] = [];
    for (let i = 0; i < 8; i++) {
      setNow(base + i * 60_000);
      const byStranger = i % 3 === 0;
      const id = await createPost(byStranger ? stranger : friend, `post ${i}`);
      if (byStranger) boost(id, 12);
      expected.push(id);
    }
    setNow(null);
    const all: Post[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const res = await feed(viewer, `?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      all.push(...res.items);
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    expect(all.map((p) => p.id)).toEqual([...expected].reverse());
    expect(all.filter((p) => p.highlight === 'popular').map((p) => p.author.id).every((id) => id === stranger.id)).toBe(true);
    expect(all.filter((p) => p.author.id === stranger.id)).toHaveLength(3);
  });

  it('the "New posts" counter only counts followed authors, never highlights', async () => {
    const viewer = ctx.createUser();
    const friend = ctx.createUser();
    const stranger = ctx.createUser();
    ctx.db.prepare('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?,?,?)').run(viewer.id, friend.id, now());
    const since = now() - 1000;
    boost(await createPost(stranger, 'popular stranger post'), 30);
    await createPost(friend, 'friend post');
    const res = await ctx.as(viewer.id).get(`/api/orbit/feed/new-count?since=${since}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

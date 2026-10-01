/**
 * orbit slice tests (SPEC §5.4 + §5 common minimum), isolation mode.
 * Feed = follows + self (+ campus highlights, see orbit-highlights.test.ts), strictly chronological; unfollow removes;
 * block both ways (posts, comments, likers);
 * new-count; poll single vote; held post invisible to followers; images must be own uploads; auth 401; validation 400;
 * moderation block 422 + author-notice hygiene; muted 403 on every create route; likes; comments + replies + delete
 * cascade; delete post → public_activity gone; adapters + card resolver; seed invariants at lite.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthedUser } from '../src/lib/users';
import { DAY, HOUR, now, setNow } from '../src/lib/clock';
import { getContentAdapter, resolveCard } from '../src/lib/content';
import { createTestApp, overrideConfig, type TestCtx } from '../src/lib/testing';

let ctx: TestCtx;

const post = (user: AuthedUser | string, body: Record<string, unknown>) =>
  ctx.as(typeof user === 'string' ? user : user.id).post('/api/orbit/posts').send(body);

async function createPost(user: AuthedUser | string, text: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await post(user, { text, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

const feedIds = async (user: AuthedUser | string, query = ''): Promise<string[]> => {
  const res = await ctx.as(typeof user === 'string' ? user : user.id).get(`/api/orbit/feed${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.items as { id: string }[]).map((p) => p.id);
};

function mute(userId: string): void {
  const at = now();
  ctx.db
    .prepare(
      `INSERT INTO user_sanctions (id, user_id, kind, scope, category, starts_at, effective_at, ends_at, created_at)
       VALUES (?,?,'mute','all','harassment_bullying',?,?,?,?)`,
    )
    .run(`san_${userId}`, userId, at - HOUR, at - HOUR, at + DAY, at - HOUR);
}

function forbiddenNoticeKeys(body: unknown): string[] {
  const text = JSON.stringify(body);
  return ['matches', 'ruleId', 'signals', 'engine'].filter((k) => text.includes(`"${k}"`));
}

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['orbit'] });
});

describe('auth + validation', () => {
  it('401 without a session on every endpoint group', async () => {
    const anon = ctx.anon();
    expect((await anon.get('/api/orbit/feed')).status).toBe(401);
    expect((await anon.post('/api/orbit/posts').send({ text: 'x' })).status).toBe(401);
    expect((await anon.get('/api/orbit/posts/nope')).status).toBe(401);
    expect((await anon.put('/api/orbit/posts/nope/like')).status).toBe(401);
    expect((await anon.get('/api/orbit/posts/nope/comments')).status).toBe(401);
    expect((await anon.post('/api/orbit/feed/seen')).status).toBe(401);
  });

  it('400 on an empty post, too many options, oversize text, bad poll; 404 for a missing post', async () => {
    const maya = ctx.as('mayachen');
    const empty = await maya.post('/api/orbit/posts').send({ text: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('validation_failed');
    expect((await maya.post('/api/orbit/posts').send({ text: 'x'.repeat(1001) })).status).toBe(400);
    expect((await maya.post('/api/orbit/posts').send({ text: 'poll', poll: { options: ['one'] } })).status).toBe(400);
    expect((await maya.post('/api/orbit/posts').send({ text: 'poll', poll: { options: ['a', 'b', 'c', 'd', 'e'] } })).status).toBe(400);
    expect((await maya.post('/api/orbit/posts').send({ text: 'imgs', images: Array.from({ length: 5 }, (_, i) => ({ url: `/seed-media/x${i}.svg` })) })).status).toBe(400);
    expect((await maya.get('/api/orbit/posts/does-not-exist')).status).toBe(404);
    expect((await maya.get('/api/orbit/feed/new-count?since=abc')).status).toBe(400);
    expect((await maya.get('/api/orbit/feed?cursor=tampered.xx')).status).toBe(400);
  });
});

describe('feed', () => {
  it('contains follows + self (a stranger\'s ordinary post stays out), strictly reverse-chronological, with lastVisitAt + followingCount', async () => {
    const a = ctx.createUser({ handle: 'orb_a' });
    const b = ctx.createUser({ handle: 'orb_b' });
    const stranger = ctx.createUser({ handle: 'orb_stranger' });
    const viewer = ctx.createUser({ handle: 'orb_viewer', follows: [a.id, b.id] });

    const p1 = await createPost(a, 'first from a');
    const p2 = await createPost(b, 'first from b');
    await createPost(stranger, 'nobody follows me');
    const p3 = await createPost(viewer, 'my own post');
    const p4 = await createPost(a, 'second from a');

    const res = await ctx.as(viewer.id).get('/api/orbit/feed');
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string; createdAt: number; author: { handle: string }; viewer: { isSelf: boolean } }[];
    expect(items.map((p) => p.id)).toEqual([p4, p3, p2, p1]);
    for (let i = 1; i < items.length; i++) expect(items[i - 1]!.createdAt).toBeGreaterThanOrEqual(items[i]!.createdAt);
    expect(items.some((p) => p.author.handle === 'orb_stranger')).toBe(false);
    expect(items.find((p) => p.id === p3)!.viewer.isSelf).toBe(true);
    expect(res.body.lastVisitAt).toBeNull();
    expect(res.body.followingCount).toBe(2);
    expect(res.headers['cache-control']).toContain('no-store');

    // the author's own summary is the real public profile
    expect(items[0]!.author).toMatchObject({ id: a.id, handle: 'orb_a' });
  });

  it('pages with an opaque cursor and never repeats or skips', async () => {
    const a = ctx.createUser();
    const viewer = ctx.createUser({ follows: [a.id] });
    const ids: string[] = [];
    const base = now();
    for (let i = 0; i < 7; i++) {
      setNow(base + i * 1000); // distinct timestamps: same-ms posts legitimately tie-break by id
      ids.push(await createPost(a, `post ${i}`));
    }
    setNow(null);
    const page1 = await ctx.as(viewer.id).get('/api/orbit/feed?limit=3');
    expect(page1.body.items).toHaveLength(3);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await ctx.as(viewer.id).get(`/api/orbit/feed?limit=3&cursor=${encodeURIComponent(page1.body.nextCursor)}`);
    const page3 = await ctx.as(viewer.id).get(`/api/orbit/feed?limit=3&cursor=${encodeURIComponent(page2.body.nextCursor)}`);
    const all = [...page1.body.items, ...page2.body.items, ...page3.body.items].map((p: { id: string }) => p.id);
    expect(all).toEqual([...ids].reverse());
    expect(page3.body.nextCursor).toBeNull();
  });

  it('unfollow removes the author’s posts from the feed', async () => {
    const a = ctx.createUser();
    const viewer = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'hello');
    expect(await feedIds(viewer)).toContain(id);
    expect((await ctx.as(viewer.id).delete(`/api/users/${a.id}/follow`)).status).toBe(200);
    expect(await feedIds(viewer)).not.toContain(id);
  });

  it('new-count counts feed posts after `since`; /feed/seen sets lastVisitAt', async () => {
    const a = ctx.createUser();
    const viewer = ctx.createUser({ follows: [a.id] });
    const before = now() - 1;
    await createPost(a, 'one');
    await createPost(a, 'two');
    const nc = await ctx.as(viewer.id).get(`/api/orbit/feed/new-count?since=${before}`);
    expect(nc.status).toBe(200);
    expect(nc.body).toEqual({ count: 2 });
    const later = await ctx.as(viewer.id).get(`/api/orbit/feed/new-count?since=${now() + 60_000}`);
    expect(later.body.count).toBe(0);

    expect((await ctx.as(viewer.id).post('/api/orbit/feed/seen')).status).toBe(204);
    const feed = await ctx.as(viewer.id).get('/api/orbit/feed');
    expect(typeof feed.body.lastVisitAt).toBe('number');
    expect(Math.abs(feed.body.lastVisitAt - now())).toBeLessThan(5_000);
  });

  it('a held post is visible to its author (with status) and invisible to followers, the feed count and the detail', async () => {
    const a = ctx.createUser();
    const viewer = ctx.createUser({ follows: [a.id] });
    // 5 active strike points make a flag on a public surface `held` (safety §2.5 account modifiers)
    ctx.db
      .prepare(
        `INSERT INTO strikes (id, user_id, entity_type, entity_id, category, severity, points, action_id, expires_at, created_at)
         VALUES ('st_1', ?, 'orbit_post', 'x', 'harassment_bullying', 'high', 5, 'act_1', NULL, ?)`,
      )
      .run(a.id, now() - HOUR);
    const res = await post(a, { text: 'hope you die' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('held');
    expect(res.body.moderation.status).toBe('held');
    expect(forbiddenNoticeKeys(res.body)).toEqual([]);
    const id = res.body.id as string;

    expect(await feedIds(a)).toContain(id);
    expect((await ctx.as(a.id).get(`/api/orbit/posts/${id}`)).body.status).toBe('held');
    expect(await feedIds(viewer)).not.toContain(id);
    expect((await ctx.as(viewer.id).get(`/api/orbit/posts/${id}`)).status).toBe(404);
    expect((await ctx.as(viewer.id).get(`/api/orbit/feed/new-count?since=0`)).body.count).toBe(0);
    // held → no public_activity, no ws fan-out
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post' AND entity_id = ?").get(id)).toEqual({ n: 0 });
    expect(ctx.wsEventsFor(viewer.id).filter((e) => e.type === 'orbit.new_post')).toHaveLength(0);
  });
});

describe('create / delete', () => {
  it('creates an active post: public_activity row, post_count, ws orbit.new_post to followers, moderation notice', async () => {
    const a = ctx.createUser();
    const follower = ctx.createUser({ follows: [a.id] });
    const res = await post(a, { text: 'Hello orbit', images: [{ url: '/seed-media/generated/event-covers/social.svg', width: 1280, height: 720 }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      text: 'Hello orbit', status: 'active', likeCount: 0, commentCount: 0, poll: null,
      viewer: { liked: false, isSelf: true }, moderation: { status: 'active', userMessage: null, support: null },
    });
    expect(res.body.images).toEqual([{ url: '/seed-media/generated/event-covers/social.svg', width: 1280, height: 720 }]);
    expect(forbiddenNoticeKeys(res.body)).toEqual([]);
    const id = res.body.id as string;
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post' AND entity_id = ?").get(id)).toEqual({ n: 1 });
    expect((ctx.db.prepare('SELECT post_count FROM users WHERE id = ?').get(a.id) as { post_count: number }).post_count).toBe(1);
    expect(ctx.wsEventsFor(follower.id).some((e) => e.type === 'orbit.new_post')).toBe(true);
    expect(ctx.wsEventsFor(a.id).some((e) => e.type === 'orbit.new_post')).toBe(false);

    // delete: 204, gone for everyone, public_activity removed, counter back to 0, non-owner → 404
    expect((await ctx.as(follower.id).delete(`/api/orbit/posts/${id}`)).status).toBe(404);
    expect((await ctx.as(a.id).delete(`/api/orbit/posts/${id}`)).status).toBe(204);
    expect((await ctx.as(a.id).get(`/api/orbit/posts/${id}`)).status).toBe(404);
    expect(await feedIds(follower)).not.toContain(id);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post' AND entity_id = ?").get(id)).toEqual({ n: 0 });
    expect((ctx.db.prepare('SELECT post_count FROM users WHERE id = ?').get(a.id) as { post_count: number }).post_count).toBe(0);
    expect((await ctx.as(a.id).delete(`/api/orbit/posts/${id}`)).status).toBe(404);
  });

  it('images must be the author’s own uploads (or seed media)', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser();
    ctx.db
      .prepare('INSERT INTO uploads (id, user_id, kind, purpose, mime, url, size, width, height, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('up_b', b.id, 'image', 'image', 'image/jpeg', '/uploads/bimg.jpg', 1000, 800, 600, null, now());
    ctx.db
      .prepare('INSERT INTO uploads (id, user_id, kind, purpose, mime, url, size, width, height, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run('up_a', a.id, 'image', 'image', 'image/jpeg', '/uploads/aimg.jpg', 1000, 640, 480, null, now());
    const foreign = await post(a, { text: 'pic', images: [{ url: '/uploads/bimg.jpg', width: 800, height: 600 }] });
    expect(foreign.status).toBe(404);
    const external = await post(a, { text: 'pic', images: [{ url: 'https://example.com/x.jpg', width: 1, height: 1 }] });
    expect(external.status).toBe(404);
    const own = await post(a, { text: 'pic', images: [{ url: '/uploads/aimg.jpg', width: 1, height: 1 }] });
    expect(own.status).toBe(201);
    // dimensions come from the upload row, not the client
    expect(own.body.images[0]).toMatchObject({ url: '/uploads/aimg.jpg', width: 640, height: 480 });
    expect(ctx.fetchSpy.calls).toBe(0);
  });

  it('a blocked write returns 422 content_blocked with a clean author notice; nothing is stored', async () => {
    const a = ctx.createUser();
    const res = await post(a, { text: 'I am going to kill you' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('content_blocked');
    expect(res.body.error.details).toMatchObject({ messageId: 'M-THREAT', category: 'threat_violence' });
    expect(forbiddenNoticeKeys(res.body)).toEqual([]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM orbit_posts WHERE author_id = ?').get(a.id)).toEqual({ n: 0 });
    // poll options are moderated too
    const poll = await post(a, { text: 'vote', poll: { options: ['fine', 'kys loser'] } });
    expect(poll.status).toBe(422);
  });

  it('muted users get 403 muted on every create route (posts, comments); reads and likes still work', async () => {
    const a = ctx.createUser();
    const m = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'open for comments');
    mute(m.id);
    const p = await post(m, { text: 'silenced' });
    expect(p.status).toBe(403);
    expect(p.body.error.code).toBe('muted');
    const c = await ctx.as(m.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'silenced' });
    expect(c.status).toBe(403);
    expect(c.body.error.code).toBe('muted');
    expect((await ctx.as(m.id).get('/api/orbit/feed')).status).toBe(200);
    expect((await ctx.as(m.id).put(`/api/orbit/posts/${id}/like`)).status).toBe(200);
  });

  it('polls need a 24 h old account', async () => {
    const fresh = ctx.createUser({ createdAt: now() - HOUR });
    const res = await post(fresh, { text: 'poll', poll: { options: ['a', 'b'] } });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ reason: 'account_too_new' });
    expect((await post(fresh, { text: 'no poll' })).status).toBe(201);
  });
});

describe('likes + likers', () => {
  it('like is idempotent, counts once, notifies the author once, unlike decrements', async () => {
    const a = ctx.createUser();
    const v = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'like me');
    const first = await ctx.as(v.id).put(`/api/orbit/posts/${id}/like`);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ liked: true, likeCount: 1 });
    const again = await ctx.as(v.id).put(`/api/orbit/posts/${id}/like`);
    expect(again.body).toEqual({ liked: true, likeCount: 1 });
    expect((await ctx.as(v.id).get(`/api/orbit/posts/${id}`)).body.viewer.liked).toBe(true);
    const notifs = ctx.db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'post.like'").all(a.id) as { actor_id: string; href: string; data_json: string }[];
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ actor_id: v.id, href: `/post/${id}` });
    expect(JSON.parse(notifs[0]!.data_json)).toMatchObject({ snippet: 'like me' });
    // self-like: allowed, never a notification
    expect((await ctx.as(a.id).put(`/api/orbit/posts/${id}/like`)).body).toEqual({ liked: true, likeCount: 2 });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'post.like'").get(a.id)).toEqual({ n: 1 });

    const likers = await ctx.as(v.id).get(`/api/orbit/posts/${id}/likers`);
    expect(likers.status).toBe(200);
    expect((likers.body.items as { id: string }[]).map((u) => u.id).sort()).toEqual([a.id, v.id].sort());
    expect(likers.body.nextCursor).toBeNull();

    const un = await ctx.as(v.id).delete(`/api/orbit/posts/${id}/like`);
    expect(un.body).toEqual({ liked: false, likeCount: 1 });
    expect((await ctx.as(v.id).delete(`/api/orbit/posts/${id}/like`)).body).toEqual({ liked: false, likeCount: 1 });
    expect((ctx.db.prepare('SELECT like_count FROM orbit_posts WHERE id = ?').get(id) as { like_count: number }).like_count).toBe(1);
  });
});

describe('polls', () => {
  it('one vote per viewer: repeat same option is idempotent, another option → 409, results are live', async () => {
    const a = ctx.createUser();
    const v = ctx.createUser({ follows: [a.id] });
    const res = await post(a, { text: 'pick', poll: { options: ['Alpha', 'Beta', 'Gamma'] } });
    expect(res.status).toBe(201);
    expect(res.body.poll).toMatchObject({ totalVotes: 0, myChoice: null });
    expect(res.body.poll.options).toHaveLength(3);
    const id = res.body.id as string;
    const [o1, o2] = res.body.poll.options as { id: string }[];

    const vote = await ctx.as(v.id).post(`/api/orbit/posts/${id}/poll/vote`).send({ optionId: o1!.id });
    expect(vote.status).toBe(200);
    expect(vote.body).toMatchObject({ totalVotes: 1, myChoice: o1!.id });
    expect(vote.body.options[0]).toMatchObject({ votes: 1, pct: 100 });
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${id}/poll/vote`).send({ optionId: o1!.id })).status).toBe(200);
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${id}/poll/vote`).send({ optionId: o2!.id })).status).toBe(409);
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${id}/poll/vote`).send({ optionId: 'nope' })).status).toBe(400);
    expect((ctx.db.prepare('SELECT COUNT(*) AS n FROM orbit_poll_votes WHERE post_id = ?').get(id) as { n: number }).n).toBe(1);

    const other = await ctx.as(a.id).post(`/api/orbit/posts/${id}/poll/vote`).send({ optionId: o2!.id });
    expect(other.body).toMatchObject({ totalVotes: 2, myChoice: o2!.id });
    expect(other.body.options.map((o: { pct: number }) => o.pct)).toEqual([50, 50, 0]);
    // a post without a poll
    const plain = await createPost(a, 'no poll here');
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${plain}/poll/vote`).send({ optionId: 'x' })).status).toBe(400);
  });

  it('a feed page with several polls serializes each poll (options, totals, myChoice) against the right post', async () => {
    const a = ctx.createUser();
    const v = ctx.createUser({ follows: [a.id] });
    const base = now();
    const polls: { id: string; options: { id: string }[] }[] = [];
    for (let i = 0; i < 3; i++) {
      setNow(base + i * 1000);
      const res = await post(a, { text: `poll ${i}`, poll: { options: [`${i}-a`, `${i}-b`] } });
      expect(res.status).toBe(201);
      polls.push({ id: res.body.id, options: res.body.poll.options });
    }
    setNow(base + 5000);
    const plain = await createPost(a, 'no poll');
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${polls[0]!.id}/poll/vote`).send({ optionId: polls[0]!.options[1]!.id })).status).toBe(200);
    expect((await ctx.as(a.id).post(`/api/orbit/posts/${polls[0]!.id}/poll/vote`).send({ optionId: polls[0]!.options[1]!.id })).status).toBe(200);
    expect((await ctx.as(v.id).post(`/api/orbit/posts/${polls[2]!.id}/poll/vote`).send({ optionId: polls[2]!.options[0]!.id })).status).toBe(200);

    const feed = await ctx.as(v.id).get('/api/orbit/feed');
    expect(feed.status).toBe(200);
    const byId = new Map((feed.body.items as { id: string; poll: { totalVotes: number; myChoice: string | null; options: { text: string; votes: number; pct: number }[] } | null }[]).map((p) => [p.id, p]));
    expect(byId.get(plain)!.poll).toBeNull();
    expect(byId.get(polls[0]!.id)!.poll).toMatchObject({ totalVotes: 2, myChoice: polls[0]!.options[1]!.id });
    expect(byId.get(polls[0]!.id)!.poll!.options.map((o) => [o.text, o.votes, o.pct])).toEqual([['0-a', 0, 0], ['0-b', 2, 100]]);
    expect(byId.get(polls[1]!.id)!.poll).toMatchObject({ totalVotes: 0, myChoice: null });
    expect(byId.get(polls[1]!.id)!.poll!.options.map((o) => o.text)).toEqual(['1-a', '1-b']);
    expect(byId.get(polls[2]!.id)!.poll).toMatchObject({ totalVotes: 1, myChoice: polls[2]!.options[0]!.id });
    // the author sees their own vote, not the viewer's
    const mine = await ctx.as(a.id).get(`/api/orbit/posts/${polls[2]!.id}`);
    expect(mine.body.poll).toMatchObject({ totalVotes: 1, myChoice: null });
  });
});

describe('comments', () => {
  it('top-level newest first with nested replies oldest first; counters; notifications; delete cascades', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const c = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'discuss');

    const c1 = await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'first comment' });
    expect(c1.status, JSON.stringify(c1.body)).toBe(201);
    expect(c1.body).toMatchObject({ postId: id, parentId: null, text: 'first comment', replyCount: 0, replies: [], viewer: { isSelf: true }, status: 'active' });
    expect(c1.body.moderation).toEqual({ status: 'active', userMessage: null, support: null });
    const c2 = await ctx.as(c.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'second comment' });
    expect(c2.status, JSON.stringify(c2.body)).toBe(201);
    const r1 = await ctx.as(a.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'reply to first', parentId: c1.body.id });
    expect(r1.status).toBe(201);
    expect(r1.body.parentId).toBe(c1.body.id);
    // a reply to a reply flattens onto the top-level comment
    const r2 = await ctx.as(c.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'reply to the reply', parentId: r1.body.id });
    expect(r2.body.parentId).toBe(c1.body.id);

    const list = await ctx.as(b.id).get(`/api/orbit/posts/${id}/comments`);
    expect(list.status).toBe(200);
    const items = list.body.items as { id: string; replies: { id: string }[]; replyCount: number }[];
    expect(items.map((x) => x.id)).toEqual([c2.body.id, c1.body.id]);
    expect(items[1]!.replies.map((x) => x.id)).toEqual([r1.body.id, r2.body.id]);
    expect(items[1]!.replyCount).toBe(2);
    expect((await ctx.as(b.id).get(`/api/orbit/posts/${id}`)).body.commentCount).toBe(4);

    // notifications: post author got post.comment (collapsed by target) from b and c; b got a comment_reply from a
    const toA = ctx.db.prepare("SELECT type, actor_count FROM notifications WHERE user_id = ? AND type = 'post.comment'").all(a.id) as { actor_count: number }[];
    expect(toA).toHaveLength(1);
    expect(toA[0]!.actor_count).toBe(2);
    const toB = ctx.db.prepare("SELECT type FROM notifications WHERE user_id = ? AND type = 'post.comment_reply'").all(b.id);
    expect(toB).toHaveLength(1);
    // a reply to a reply notifies the person actually answered (r1's author a), targeted at the tapped reply
    const toAReply = ctx.db
      .prepare("SELECT actor_id, target_type, target_id FROM notifications WHERE user_id = ? AND type = 'post.comment_reply'")
      .all(a.id);
    expect(toAReply).toEqual([{ actor_id: c.id, target_type: 'orbit_comment', target_id: r1.body.id }]);

    // deleting: stranger → 404; post author may delete anyone's comment; cascade removes replies + counters
    const stranger = ctx.createUser();
    expect((await ctx.as(stranger.id).delete(`/api/orbit/comments/${c1.body.id}`)).status).toBe(404);
    expect((await ctx.as(a.id).delete(`/api/orbit/comments/${c1.body.id}`)).status).toBe(204);
    const after = await ctx.as(b.id).get(`/api/orbit/posts/${id}/comments`);
    expect((after.body.items as { id: string }[]).map((x) => x.id)).toEqual([c2.body.id]);
    expect((await ctx.as(b.id).get(`/api/orbit/posts/${id}`)).body.commentCount).toBe(1);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM orbit_comments WHERE post_id = ? AND status = 'deleted'").get(id)).toEqual({ n: 3 });
    expect(
      ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'orbit_comment' AND target_id IN (?,?,?)").get(c1.body.id, r1.body.id, r2.body.id),
    ).toEqual({ n: 0 });
    // own comment delete works for the commenter
    expect((await ctx.as(c.id).delete(`/api/orbit/comments/${c2.body.id}`)).status).toBe(204);
    const finalRes = await ctx.as(b.id).get(`/api/orbit/posts/${id}`);
    expect(finalRes.status, JSON.stringify(finalRes.body)).toBe(200);
    expect(finalRes.body.commentCount).toBe(0);
  });

  it('comment validation + moderation: empty 400, blocked 422, held comment visible only to its author', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'discuss');
    expect((await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: '  ' })).status).toBe(400);
    const blocked = await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'kys loser' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('content_blocked');
    expect((await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'ok', parentId: 'missing' })).status).toBe(404);

    const held = await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'seen only by me' });
    expect(held.status).toBe(201);
    ctx.db.prepare("UPDATE orbit_comments SET status = 'held' WHERE id = ?").run(held.body.id);
    expect((await ctx.as(b.id).get(`/api/orbit/posts/${id}/comments`)).body.items.map((c: { id: string }) => c.id)).toContain(held.body.id);
    expect((await ctx.as(a.id).get(`/api/orbit/posts/${id}/comments`)).body.items.map((c: { id: string }) => c.id)).not.toContain(held.body.id);
  });
});

describe('blocks (public surface: both directions)', () => {
  it('hides posts, comments and likers both ways; the blocked user gets the generic 404 on detail', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id], followedBy: [a.id] });
    const c = ctx.createUser({ follows: [a.id, b.id] });
    const pa = await createPost(a, 'post by a');
    const pb = await createPost(b, 'post by b');
    const cb = await ctx.as(b.id).post(`/api/orbit/posts/${pa}/comments`).send({ text: 'b comments on a' });
    expect(cb.status).toBe(201);
    expect((await ctx.as(b.id).put(`/api/orbit/posts/${pa}/like`)).status).toBe(200);

    // sanity before the block
    expect(await feedIds(a)).toContain(pb);
    expect(await feedIds(b)).toContain(pa);

    expect((await ctx.as(a.id).post(`/api/users/${b.id}/block`)).status).toBe(200);

    // feeds (the follow edges are gone AND the block filter applies)
    expect(await feedIds(a)).not.toContain(pb);
    expect(await feedIds(b)).not.toContain(pa);
    // detail both ways
    expect((await ctx.as(a.id).get(`/api/orbit/posts/${pb}`)).status).toBe(404);
    expect((await ctx.as(b.id).get(`/api/orbit/posts/${pa}`)).status).toBe(404);
    // a third party still sees both, but a's view of the comments hides b's comment
    expect(await feedIds(c)).toEqual(expect.arrayContaining([pa, pb]));
    const commentsForA = await ctx.as(a.id).get(`/api/orbit/posts/${pa}/comments`);
    expect(commentsForA.body.items).toHaveLength(0);
    const commentsForC = await ctx.as(c.id).get(`/api/orbit/posts/${pa}/comments`);
    expect(commentsForC.body.items).toHaveLength(1);
    // likers: b is removed from a's likers list; the like row still exists (counts stay honest)
    const likers = await ctx.as(a.id).get(`/api/orbit/posts/${pa}/likers`);
    expect((likers.body.items as { id: string }[]).map((u) => u.id)).not.toContain(b.id);
    // per-user lists both ways
    expect((await ctx.as(a.id).get(`/api/orbit/users/${b.id}/posts`)).body.items).toHaveLength(0);
    expect((await ctx.as(b.id).get(`/api/orbit/users/${a.id}/posts`)).status).toBe(404);
    // b cannot like or comment on a's post any more
    expect((await ctx.as(b.id).put(`/api/orbit/posts/${pa}/like`)).status).toBe(404);
    expect((await ctx.as(b.id).post(`/api/orbit/posts/${pa}/comments`).send({ text: 'hi' })).status).toBe(404);
  });

  it('a reported post disappears for the reporter only', async () => {
    const a = ctx.createUser();
    const v = ctx.createUser({ follows: [a.id] });
    const w = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'reportable');
    const rep = await ctx.as(v.id).post('/api/reports').send({ entityType: 'orbit_post', entityId: id, reason: 'spam_scam' });
    expect(rep.status, JSON.stringify(rep.body)).toBe(200);
    expect(await feedIds(v)).not.toContain(id);
    expect((await ctx.as(v.id).get(`/api/orbit/posts/${id}`)).status).toBe(404);
    expect(await feedIds(w)).toContain(id);
  });
});

describe('user posts + suspended authors', () => {
  it('lists a user’s posts (self sees held), and a suspended author vanishes from every read', async () => {
    const a = ctx.createUser();
    const v = ctx.createUser({ follows: [a.id] });
    const p1 = await createPost(a, 'one');
    const p2 = await createPost(a, 'two');
    ctx.db.prepare("UPDATE orbit_posts SET status = 'held' WHERE id = ?").run(p2);
    const mine = await ctx.as(a.id).get(`/api/orbit/users/${a.id}/posts`);
    expect((mine.body.items as { id: string }[]).map((p) => p.id)).toEqual([p2, p1]);
    const theirs = await ctx.as(v.id).get(`/api/orbit/users/${a.id}/posts`);
    expect((theirs.body.items as { id: string }[]).map((p) => p.id)).toEqual([p1]);
    expect((await ctx.as(v.id).get('/api/orbit/users/nobody/posts')).status).toBe(404);

    ctx.db.prepare("UPDATE users SET status = 'suspended' WHERE id = ?").run(a.id);
    expect(await feedIds(v)).toEqual([]);
    expect((await ctx.as(v.id).get(`/api/orbit/posts/${p1}`)).status).toBe(404);
    expect((await ctx.as(v.id).get(`/api/orbit/users/${a.id}/posts`)).status).toBe(404);
  });
});

describe('registry: adapters + card resolver', () => {
  it('orbit_post / orbit_comment adapters load snapshots and keep public_activity + counters in sync', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const res = await post(a, { text: 'adapt me', poll: { options: ['x', 'y'] } });
    const id = res.body.id as string;
    const cm = await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'a comment' });

    const postAdapter = getContentAdapter('orbit_post')!;
    expect(postAdapter).toBeTruthy();
    const snap = postAdapter.load(id)!;
    expect(snap).toMatchObject({ entityType: 'orbit_post', entityId: id, authorId: a.id, status: 'active', surface: 'orbit_post', anon: false, label: 'post', href: `/post/${id}` });
    expect(snap.fields).toEqual([{ field: 'body', text: 'adapt me' }, { field: 'option', text: 'x' }, { field: 'option', text: 'y' }]);
    expect(postAdapter.load('missing')).toBeNull();

    postAdapter.setStatus(id, 'hidden');
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post' AND entity_id = ?").get(id)).toEqual({ n: 0 });
    expect(await feedIds(b)).not.toContain(id);
    expect((await ctx.as(a.id).get(`/api/orbit/posts/${id}`)).body.status).toBe('hidden');
    postAdapter.setStatus(id, 'active', { immune: true });
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post' AND entity_id = ?").get(id)).toEqual({ n: 1 });
    expect(postAdapter.load(id)!.autoHideImmune).toBe(true);
    expect(await feedIds(b)).toContain(id);
    postAdapter.setStatus(id, 'removed');
    expect((await ctx.as(b.id).get(`/api/orbit/posts/${id}`)).status).toBe(404);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE target_type = 'orbit_post' AND target_id = ?").get(id)).toEqual({ n: 0 });

    const commentAdapter = getContentAdapter('orbit_comment')!;
    const csnap = commentAdapter.load(cm.body.id)!;
    expect(csnap).toMatchObject({ entityType: 'orbit_comment', authorId: b.id, surface: 'comment', label: 'comment', parent: { entityType: 'orbit_post', entityId: id } });
    commentAdapter.setStatus(cm.body.id, 'hidden');
    expect((ctx.db.prepare('SELECT comment_count FROM orbit_posts WHERE id = ?').get(id) as { comment_count: number }).comment_count).toBe(0);
    commentAdapter.setStatus(cm.body.id, 'active');
    expect((ctx.db.prepare('SELECT comment_count FROM orbit_posts WHERE id = ?').get(id) as { comment_count: number }).comment_count).toBe(1);
  });

  it('staff removal purges every notification that deep-links to the post, comment-targeted replies included', async () => {
    const a = ctx.createUser();
    const b = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'to be removed');
    const cm = await ctx.as(b.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'a comment' });
    expect(cm.status).toBe(201);
    expect((await ctx.as(a.id).post(`/api/orbit/posts/${id}/comments`).send({ text: 'a reply', parentId: cm.body.id })).status).toBe(201);
    expect((await ctx.as(b.id).put(`/api/orbit/posts/${id}/like`)).status).toBe(200);
    const linked = () =>
      ctx.db
        .prepare("SELECT target_type FROM notifications WHERE (target_type = 'orbit_post' AND target_id = ?) OR (target_type = 'orbit_comment' AND target_id = ?)")
        .all(id, cm.body.id) as { target_type: string }[];
    expect(linked().map((r) => r.target_type).sort()).toEqual(['orbit_comment', 'orbit_post', 'orbit_post']); // comment_reply → b, comment + like → a

    getContentAdapter('orbit_post')!.setStatus(id, 'removed');
    expect(linked()).toEqual([]);
  });

  it('the `post` card resolves live, applies status + block rules, and is served by GET /cards/post/:id', async () => {
    const a = ctx.createUser({ handle: 'card_author' });
    const v = ctx.createUser({ follows: [a.id] });
    const id = await createPost(a, 'Share this post with the world', { images: [{ url: '/seed-media/generated/event-covers/arts.svg', width: 1280, height: 720 }] });
    const card = resolveCard({ kind: 'post', id }, v.id);
    expect(card).toMatchObject({ kind: 'post', id, title: 'Share this post with the world', subtitle: '@card_author · Orbit', href: `/post/${id}`, status: 'available', ownerId: a.id, imageUrl: '/seed-media/generated/event-covers/arts.svg' });
    const http = await ctx.as(v.id).get(`/api/cards/post/${id}`);
    expect(http.status).toBe(200);
    expect(http.body).toMatchObject({ kind: 'post', id, status: 'available' });
    expect(resolveCard({ kind: 'post', id: 'missing' }, v.id).status).toBe('unavailable');
    expect((await ctx.as(a.id).post(`/api/users/${v.id}/block`)).status).toBe(200);
    expect(resolveCard({ kind: 'post', id }, v.id).status).toBe('unavailable');
    ctx.db.prepare("UPDATE orbit_posts SET status = 'hidden' WHERE id = ?").run(id);
    expect(resolveCard({ kind: 'post', id }, a.id).title).toBe('Share this post with the world'); // author still sees own
    expect(resolveCard({ kind: 'post', id }, ctx.createUser().id).status).toBe('unavailable');
  });
});

describe('seed (lite)', () => {
  it('seeds Maya’s 5 posts, honest counters, public_activity rows and exactly her 2 orbit notifications', async () => {
    const seeded = await createTestApp({ slices: ['orbit'], seed: 'all' });
    const posts = seeded.db.prepare("SELECT COUNT(*) AS n FROM orbit_posts WHERE status = 'active'").get() as { n: number };
    expect(posts.n).toBe(25);
    const mayas = seeded.db.prepare("SELECT id FROM orbit_posts WHERE author_id = 'u_mayachen' ORDER BY id").all() as { id: string }[];
    expect(mayas.map((p) => p.id)).toEqual(['post_0001', 'post_0002', 'post_0003', 'post_0004', 'post_0005']);
    expect((seeded.db.prepare("SELECT post_count FROM users WHERE id = 'u_mayachen'").get() as { post_count: number }).post_count).toBe(5);
    expect((seeded.db.prepare("SELECT COUNT(*) AS n FROM public_activity WHERE kind = 'post'").get() as { n: number }).n).toBe(25);
    expect((seeded.db.prepare("SELECT COUNT(*) AS n FROM orbit_posts WHERE has_poll = 1").get() as { n: number }).n).toBe(3);
    expect((seeded.db.prepare("SELECT COUNT(*) AS n FROM orbit_posts p JOIN users u ON u.id = p.author_id WHERE u.account_type = 'org'").get() as { n: number }).n).toBeGreaterThanOrEqual(5);
    // counters == rows, everywhere
    const drift = seeded.db
      .prepare(
        `SELECT COUNT(*) AS n FROM orbit_posts p
          WHERE p.like_count != (SELECT COUNT(*) FROM orbit_likes l WHERE l.post_id = p.id)
             OR p.comment_count != (SELECT COUNT(*) FROM orbit_comments c WHERE c.post_id = p.id AND c.status = 'active')`,
      )
      .get() as { n: number };
    expect(drift.n).toBe(0);
    const replyDrift = seeded.db
      .prepare('SELECT COUNT(*) AS n FROM orbit_comments c WHERE c.reply_count != (SELECT COUNT(*) FROM orbit_comments r WHERE r.parent_id = c.id AND r.status = \'active\')')
      .get() as { n: number };
    expect(replyDrift.n).toBe(0);
    const optDrift = seeded.db
      .prepare('SELECT COUNT(*) AS n FROM orbit_poll_options o WHERE o.vote_count != (SELECT COUNT(*) FROM orbit_poll_votes v WHERE v.option_id = o.id)')
      .get() as { n: number };
    expect(optDrift.n).toBe(0);
    const userDrift = seeded.db
      .prepare("SELECT COUNT(*) AS n FROM users u WHERE u.post_count != (SELECT COUNT(*) FROM public_activity a WHERE a.user_id = u.id AND a.kind = 'post')")
      .get() as { n: number };
    expect(userDrift.n).toBe(0);
    // Maya: one post.like (read, collapsed) + one post.comment (unread)
    const notifs = seeded.db.prepare("SELECT type, read_at, actor_count FROM notifications WHERE user_id = 'u_mayachen' AND type LIKE 'post.%' ORDER BY type").all() as { type: string; read_at: number | null; actor_count: number }[];
    expect(notifs.map((n) => n.type)).toEqual(['post.comment', 'post.like']);
    expect(notifs[0]!.read_at).toBeNull();
    expect(notifs[1]!.read_at).not.toBeNull();
    expect(notifs[1]!.actor_count).toBeGreaterThan(1);
    // her feed works and is chronological; the divider marker exists
    const feed = await seeded.as('mayachen').get('/api/orbit/feed');
    expect(feed.status).toBe(200);
    expect(feed.body.items.length).toBeGreaterThan(5);
    expect(typeof feed.body.lastVisitAt).toBe('number');
    expect(feed.body.followingCount).toBe(28);
    for (const p of feed.body.items as { author: { handle: string }; images: { url: string }[] }[]) {
      for (const img of p.images) expect(img.url.startsWith('/seed-media/generated/orbit/')).toBe(true);
    }
    // determinism: a second run produces the same ids + texts
    const first = seeded.db.prepare('SELECT id, author_id, text, has_poll, images_json FROM orbit_posts ORDER BY id').all();
    const again = await createTestApp({ slices: ['orbit'], seed: 'all' });
    expect(again.db.prepare('SELECT id, author_id, text, has_poll, images_json FROM orbit_posts ORDER BY id').all()).toEqual(first);
  });

  it('seeds the full scale too: ~90 posts, ~55 hero, 8 polls, a third from orgs, no drift', async () => {
    const restore = overrideConfig({ seedScale: 'full' });
    try {
      const seeded = await createTestApp({ slices: ['orbit'], seed: 'all' });
      const n = (sql: string): number => (seeded.db.prepare(sql).get() as { n: number }).n;
      expect(n("SELECT COUNT(*) AS n FROM orbit_posts WHERE status = 'active'")).toBe(90);
      expect(n('SELECT COUNT(*) AS n FROM orbit_posts WHERE has_poll = 1')).toBe(8);
      expect(n("SELECT COUNT(*) AS n FROM orbit_posts WHERE university_id = 'uni_utexas'")).toBeGreaterThanOrEqual(50);
      const orgPosts = n("SELECT COUNT(*) AS n FROM orbit_posts p JOIN users u ON u.id = p.author_id WHERE u.account_type = 'org'");
      expect(orgPosts).toBeGreaterThanOrEqual(20);
      expect(orgPosts).toBeLessThanOrEqual(40);
      expect(n("SELECT COUNT(*) AS n FROM orbit_posts WHERE images_json != '[]'")).toBeGreaterThanOrEqual(20);
      expect(n("SELECT COUNT(*) AS n FROM orbit_posts WHERE author_id = 'u_mayachen'")).toBe(5);
      expect(n(`SELECT COUNT(*) AS n FROM orbit_posts p
          WHERE p.like_count != (SELECT COUNT(*) FROM orbit_likes l WHERE l.post_id = p.id)
             OR p.comment_count != (SELECT COUNT(*) FROM orbit_comments c WHERE c.post_id = p.id AND c.status = 'active')`)).toBe(0);
      expect(n("SELECT COUNT(*) AS n FROM users u WHERE u.post_count != (SELECT COUNT(*) FROM public_activity a WHERE a.user_id = u.id AND a.kind = 'post')")).toBe(0);
      expect(n("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_mayachen' AND type LIKE 'post.%'")).toBe(2);
      expect(n('SELECT COUNT(*) AS n FROM orbit_posts p JOIN users u ON u.id = p.author_id WHERE p.created_at < u.created_at')).toBe(0);
    } finally {
      restore();
    }
  });
});

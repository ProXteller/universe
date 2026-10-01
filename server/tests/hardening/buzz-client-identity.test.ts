/**
 * Hardening lens: Buzz identity in the client + cross-surface leaks (Constitution §5, SPEC §3.2).
 *
 * Every test replays the EXACT payload the shipped client sends (file:line quoted per test) and checks what the server
 * stores / returns. A FAILING test is a confirmed finding (left failing for the fixer); a passing one is a regression probe.
 *
 * Isolation mode: core + buzz + messages (the share-to-chat surface).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Id } from '@shared/core';
import type { Buzz, BuzzReply } from '@shared/buzz';
import { setNow } from '../../src/lib/clock';
import { getContentAdapter } from '../../src/lib/content';
import { createGroup, openDm, removeMember } from '../../src/lib/conversations';
import { assertNoForbiddenKeys, assertNoIdentityLeak, createTestApp, type TestCtx } from '../../src/lib/testing';
import type { AuthedUser } from '../../src/lib/users';

let ctx: TestCtx;

type Agent = ReturnType<TestCtx['as']>;

function person(o: Parameters<TestCtx['createUser']>[0] = {}): { user: AuthedUser; api: Agent } {
  const user = ctx.createUser(o);
  return { user, api: ctx.as(user.id) };
}

function identityOf(u: AuthedUser): string[] {
  const row = ctx.db.prepare('SELECT id, handle, display_name, email FROM users WHERE id = ?').get(u.id) as {
    id: string; handle: string; display_name: string; email: string;
  };
  return [row.id, row.handle, row.display_name, row.email];
}

const token = (() => {
  let n = 0;
  return (label: string): string => `${label} zq${++n}x${Math.random().toString(36).slice(2, 7)}`;
})();

async function postBuzz(api: Agent, text: string): Promise<Buzz> {
  const res = await api.post('/api/buzz').send({ text });
  if (res.status !== 201) throw new Error(`POST /buzz → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Buzz;
}

async function replyTo(api: Agent, threadId: Id, text: string): Promise<BuzzReply> {
  const res = await api.post(`/api/buzz/${threadId}/replies`).send({ text });
  if (res.status !== 201) throw new Error(`POST reply → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as BuzzReply;
}

/** Two mutual followers with an accepted DM (the share sheet only lists active chats). */
function friendsWithDm(): { a: { user: AuthedUser; api: Agent }; b: { user: AuthedUser; api: Agent }; conversationId: Id } {
  const a = person();
  const b = person({ follows: [a.user.id], followedBy: [a.user.id] });
  const { conversationId } = openDm(a.user, b.user.id);
  return { a, b, conversationId };
}

beforeEach(async () => {
  ctx = await createTestApp({ slices: ['buzz', 'messages'] });
});

afterEach(() => {
  setNow(null);
});

/* ─────────────────────────────── confirmed findings (expected to FAIL until fixed) ─────────────────────────────── */

describe('analytics from Buzz screens', () => {
  it('share_click fired by the Buzz share sheet is never stored with the viewer user_id next to the Buzz thread id', async () => {
    // Client: parts.tsx:251 openShare({ card:{kind:'buzz', id: threadId} }) → ShareHost (ShareSheet.tsx:194) tracks
    // share_click {kind, id, method:'sheet'}; Copy link (ShareSheet.tsx:108) tracks {kind, id, method:'copy'}.
    const author = person();
    const buzz = await postBuzz(author.api, token('my own buzz that I share first'));
    const res = await author.api.post('/api/analytics/track').send({
      events: [
        { name: 'share_click', props: { kind: 'buzz', id: buzz.threadId, method: 'sheet' }, ts: Date.now() },
        { name: 'share_click', props: { kind: 'buzz', id: buzz.threadId, method: 'copy' }, ts: Date.now() },
      ],
    });
    expect(res.status).toBe(204);

    const rows = ctx.db.prepare("SELECT user_id, session_id, props_json FROM analytics_events WHERE name = 'share_click'").all() as {
      user_id: string | null; session_id: string | null; props_json: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const props = JSON.parse(r.props_json) as Record<string, unknown>;
      if (props.kind !== 'buzz') continue;
      // A user-linked row that names a Buzz thread is an unaudited authorship/interest trail (SPEC §3.2 #8).
      expect(r.user_id, 'Buzz share analytics must be stored without user_id').toBeNull();
      expect(r.session_id).toBeNull();
      expect(r.props_json).not.toContain(buzz.threadId);
    }
  });
});

describe('analytics from Buzz screens (join oracle)', () => {
  it('anonymous Buzz events keep no exact client timestamp that joins them to the user-linked event of the same batch', async () => {
    // Client: settling on the Buzz tab fires home_tab_view {tab:'buzz'} (HomePage.tsx:136, user-linked) and the pane fires
    // buzz_feed_view {sort, scope} (pane.tsx:86, anonymous) in the same 5 s batch; lib/analytics.ts:72 stamps ts: Date.now().
    const viewer = person();
    const t = 1_790_000_000_123;
    const res = await viewer.api.post('/api/analytics/track').send({
      events: [
        { name: 'home_tab_view', props: { tab: 'buzz' }, ts: t },
        { name: 'buzz_feed_view', props: { sort: 'hot', scope: 'campus' }, ts: t + 4 },
      ],
    });
    expect(res.status).toBe(204);
    const anon = ctx.db.prepare("SELECT user_id, anon_hash, props_json, created_at FROM analytics_events WHERE name = 'buzz_feed_view'").all() as {
      user_id: string | null; anon_hash: string | null; props_json: string; created_at: number;
    }[];
    expect(anon.length).toBe(1);
    expect(anon[0]!.user_id).toBeNull();
    expect(anon[0]!.created_at % 60_000).toBe(0);
    const props = JSON.parse(anon[0]!.props_json) as Record<string, unknown>;
    // clientTs (ms precision) survives on the anonymous row and sits 4 ms from the user-linked home_tab_view row, so
    // anon_hash → user_id for the whole day (every buzz_post / buzz_vote / buzz_reply that day).
    expect(props, 'anonymous rows must not keep the millisecond client timestamp').not.toHaveProperty('clientTs');
  });
});

describe('share-to-chat of a Buzz', () => {
  it('a moderator-removed buzz does not live on in the recipient chat as the sharer caption', async () => {
    const author = person();
    const { a: sharer, b: recipient, conversationId } = friendsWithDm();
    const secret = token('the RA on floor 3 is the one stealing packages');
    const buzz = await postBuzz(author.api, secret);

    // Exact client payload: parts.tsx:251 passes text: item.text.slice(0, 140); ShareSheet.tsx:129 forwards it as the caption.
    const share = await sharer.api.post('/api/share').send({
      card: { kind: 'buzz', id: buzz.threadId }, conversationIds: [conversationId], text: buzz.text.slice(0, 140),
    });
    expect(share.status).toBe(200);
    expect(share.body.sent).toBe(1);

    // Trust & Safety removes the buzz: the card goes "No longer available" …
    getContentAdapter('buzz')!.setStatus(buzz.threadId, 'removed');
    const card = await recipient.api.get(`/api/cards/buzz/${buzz.threadId}`);
    expect(card.body.status).toBe('unavailable');

    // … but the removed Buzz text must not remain readable in Messages under the sharer's real name.
    const msgs = await recipient.api.get(`/api/conversations/${conversationId}/messages`);
    expect(msgs.status).toBe(200);
    expect(JSON.stringify(msgs.body), 'message list still carries removed Buzz text').not.toContain(secret.slice(0, 40));
    const inbox = await recipient.api.get('/api/conversations');
    expect(JSON.stringify(inbox.body), 'inbox preview still carries removed Buzz text').not.toContain(secret.slice(0, 40));
  });

  it('the share sheet opened from Buzz never lists the viewer\'s own avatar/name (member preview of a chat they are alone in)', async () => {
    const viewer = person();
    const friend = person({ follows: [viewer.user.id], followedBy: [viewer.user.id] });
    const groupId = createGroup(viewer.user, { title: null, memberIds: [friend.user.id] });
    removeMember(groupId, friend.user.id); // everyone else left: the viewer is alone in the group

    const res = await viewer.api.get('/api/share/targets');
    expect(res.status).toBe(200);
    const target = (res.body.items as { id: Id; title: string; avatarUrl: string | null; memberPreview: { id: Id }[] }[]).find((c) => c.id === groupId);
    expect(target, 'the group is a share target').toBeTruthy();
    // ShareSheet.tsx:27-37 renders memberPreview as an AvatarStack (img alt = displayName) when the group has no avatar;
    // that sheet is opened from Buzz cards (parts.tsx:251), so this puts the viewer's own face/name inside Buzz.
    expect(target!.memberPreview.map((u) => u.id)).not.toContain(viewer.user.id);
    assertNoIdentityLeak(target, identityOf(viewer.user));
  });
});

describe('Buzz notifications', () => {
  it('anonymous notification timestamps are floored to the minute like every Buzz createdAt (no exact reply-time oracle)', async () => {
    const author = person();
    const replier = person();
    const buzz = await postBuzz(author.api, token('does anyone else hear the 3am trombone'));
    setNow(Date.UTC(2026, 8, 23, 14, 3, 12, 345)); // 14:03:12.345
    const r = await replyTo(replier.api, buzz.threadId, token('every single night'));
    expect(r.createdAt % 60_000).toBe(0); // the reply itself is floored (SPEC §3.2 #3)

    const list = await author.api.get('/api/notifications');
    expect(list.status).toBe(200);
    const n = (list.body.items as { type: string; createdAt: number }[]).find((x) => x.type === 'buzz.reply');
    expect(n).toBeTruthy();
    expect(n!.createdAt % 60_000, 'GET /notifications buzz.reply createdAt must be minute-floored').toBe(0);

    const ws = ctx.wsEventsFor(author.user.id).filter((e) => e.type === 'notification') as unknown as { notification: { type: string; createdAt: number } }[];
    const pushed = ws.find((e) => e.notification.type === 'buzz.reply');
    expect(pushed).toBeTruthy();
    expect(pushed!.notification.createdAt % 60_000, 'ws notification createdAt must be minute-floored').toBe(0);
  });
});

/* ─────────────────────────────── regression probes (pass today) ─────────────────────────────── */

describe('probes', () => {
  it('the buzz share card is viewer-independent: author and stranger get byte-identical, identity-free cards', async () => {
    const author = person();
    const stranger = person();
    const buzz = await postBuzz(author.api, token('who keeps microwaving fish in the library'));
    const mine = await author.api.get(`/api/cards/buzz/${buzz.threadId}`);
    const theirs = await stranger.api.get(`/api/cards/buzz/${buzz.threadId}`);
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.body)).toBe(JSON.stringify(theirs.body));
    expect(mine.body.ownerId).toBeNull();
    expect(mine.body.imageUrl).toBeNull();
    assertNoForbiddenKeys(mine.body);
    assertNoIdentityLeak(mine.body, identityOf(author.user));
    expect(JSON.stringify(mine.body)).not.toMatch(/isMine|alias|isOp/);
  });

  it('a buzz card delivered in a DM carries nothing about the Buzz author (recipient view, card only)', async () => {
    const author = person();
    const { a: sharer, b: recipient, conversationId } = friendsWithDm();
    const buzz = await postBuzz(author.api, token('dining hall pho is back'));
    const share = await sharer.api.post('/api/share').send({ card: { kind: 'buzz', id: buzz.threadId }, conversationIds: [conversationId] });
    expect(share.status).toBe(200);
    const msgs = await recipient.api.get(`/api/conversations/${conversationId}/messages`);
    const cardMsg = (msgs.body.items as { kind: string; card: unknown }[]).find((m) => m.kind === 'card');
    expect(cardMsg).toBeTruthy();
    assertNoIdentityLeak(cardMsg!.card, identityOf(author.user));
    expect((cardMsg!.card as { ownerId: unknown }).ownerId).toBeNull();
    // the author's own ws stream saw nothing about this share
    expect(JSON.stringify(ctx.wsEventsFor(author.user.id))).not.toContain(conversationId);
  });

  it('Buzz reply ws traffic: author gets an actor-less notification; replier gets only {type, threadId}', async () => {
    const author = person();
    const replier = person();
    const buzz = await postBuzz(author.api, token('the quad geese have unionised'));
    await replyTo(replier.api, buzz.threadId, token('solidarity with the geese'));

    const authorEvents = ctx.wsEventsFor(author.user.id);
    const notif = authorEvents.find((e) => e.type === 'notification') as unknown as { notification: { anonymous: boolean; actor: unknown; actorCount: number; thumbnailUrl: unknown } } | undefined;
    expect(notif).toBeTruthy();
    expect(notif!.notification.anonymous).toBe(true);
    expect(notif!.notification.actor).toBeNull();
    expect(notif!.notification.actorCount).toBe(1);
    expect(notif!.notification.thumbnailUrl).toBeNull();
    assertNoIdentityLeak(authorEvents, identityOf(replier.user));
    assertNoForbiddenKeys(authorEvents.filter((e) => e.type === 'buzz.thread_updated'));

    for (const e of ctx.wsEventsFor(replier.user.id)) {
      if (e.type === 'buzz.thread_updated') expect(Object.keys(e).sort()).toEqual(['threadId', 'type']);
      expect(e.type).not.toBe('notification'); // never notified about their own reply
    }
  });

  it('Buzz text never reaches the author\'s public profile or people search', async () => {
    const author = person();
    const other = person();
    const secret = token('confession about the chem midterm');
    const buzz = await postBuzz(author.api, secret);
    const profile = await other.api.get(`/api/users/${author.user.handle}`);
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.body)).not.toContain(secret);
    expect(JSON.stringify(profile.body)).not.toContain(buzz.threadId);
    const search = await other.api.get('/api/users/search').query({ q: secret.split(' ').pop() });
    expect(search.status).toBe(200);
    expect(search.body.items).toEqual([]);
  });
});

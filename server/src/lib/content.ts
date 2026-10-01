/**
 * Content registry + card resolvers — the cross-slice seam (SPEC §4.2.10).   LANE S-M2a owns this file.
 *
 * Registries (content adapters, card resolvers, user lifecycle hooks): keyed by entityType / kind / name;
 * **last write wins; registering never throws**; every `register*` returns an `unregister()` that restores the
 * previous entry (out-of-order unregisters leave a newer entry alone). Slice routers register at import time (R4).
 * Foundation registers here (pure, no DB at import): the `profile` card resolver and the `profile` ContentAdapter
 * (ENTITY_OWNER.profile = 'foundation'). `message` / `conversation` adapters live in lib/conversations.ts.
 */
import type {
  ContentEntityType, ContentStatus, EpochMs, Id, ModerationSurface, ShareCard, ShareCardKind, ShareCardRef,
} from '@shared/core';
import { ANON_ENTITY_TYPES } from '@shared/core';
import { prep } from '../db/index';
import { now } from './clock';
import { log } from './logger';
import { currencyFor, getUniversityRow } from './universities';

export interface ContentSnapshot {
  entityType: ContentEntityType;
  entityId: Id;
  authorId: Id;
  universityId: Id;
  status: ContentStatus;
  surface: ModerationSurface;
  anon: boolean;
  autoHideImmune: boolean;
  createdAt: EpochMs;
  /** "reel" | "buzz" | "reply" | "post" | "comment" | "listing" | "roommate post" | "event" … */
  label: string;
  /** Original text per field. */
  fields: { field: string; text: string }[];
  media: { url: string; kind: 'image' | 'video' }[];
  /** In-app route. */
  href: string | null;
  parent: { entityType: ContentEntityType; entityId: Id } | null;
}

export interface ContentAdapter {
  entityType: ContentEntityType;
  /** Any status. */
  load(id: Id): ContentSnapshot | null;
  /** MUST keep counters + public_activity consistent (unmark on hidden/removed, mark on active) and removeNotificationsFor on removed. */
  setStatus(id: Id, status: Extract<ContentStatus, 'active' | 'hidden' | 'removed'>, opts?: { immune?: boolean }): void;
  /** Anon types: built ONLY with the blind Buzz serializer. */
  staffContext?(id: Id): unknown;
  /** Buzz root only. */
  setLocked?(id: Id, locked: boolean): void;
}

/** null → unavailable; `resolveCard` fills `currency` from the owner's (else viewer's) university. */
export type CardResolver = (id: Id, viewerId: Id) => Omit<ShareCard, 'kind' | 'id' | 'currency'> | null;

export interface UserLifecycleHook {
  onBanned?(userId: Id): void;
  onDeleted?(userId: Id): void;
}

/* ───────────────────────────── generic last-write-wins registry ───────────────────────────── */

function register<K, V>(map: Map<K, V>, key: K, value: V): () => void {
  let previous: V | undefined;
  try {
    previous = map.get(key);
    map.set(key, value);
  } catch (err) {
    log.error('registry write failed', err);
  }
  return () => {
    if (map.get(key) !== value) return; // someone registered after us: leave their entry alone
    if (previous !== undefined) map.set(key, previous);
    else map.delete(key);
  };
}

const adapters = new Map<ContentEntityType, ContentAdapter>();
const cardResolvers = new Map<ShareCardKind, CardResolver>();
const lifecycleHooks = new Map<string, UserLifecycleHook>();

/** At router import time (R4). Never throws (a malformed adapter is ignored; the unregister is then a no-op). */
export function registerContentAdapter(a: ContentAdapter): () => void {
  if (!a || typeof a.entityType !== 'string' || typeof a.load !== 'function' || typeof a.setStatus !== 'function') {
    log.error('registerContentAdapter: ignored a malformed adapter');
    return () => {};
  }
  return register(adapters, a.entityType, a);
}

export function getContentAdapter(t: ContentEntityType): ContentAdapter | null {
  return adapters.get(t) ?? null;
}

export function registerCardResolver(kind: ShareCardKind, fn: CardResolver): () => void {
  return register(cardResolvers, kind, fn);
}

export function registerUserLifecycleHook(name: string, h: UserLifecycleHook): () => void {
  return register(lifecycleHooks, name, h);
}

/** Runs every registered hook for the event; each call is isolated (try/catch + log). */
export function runUserLifecycleHooks(event: keyof UserLifecycleHook, userId: Id): void {
  for (const [name, hook] of [...lifecycleHooks]) {
    try {
      hook[event]?.(userId);
    } catch (err) {
      log.error(`user lifecycle hook "${name}".${event} failed`, err);
    }
  }
}

export function isAnonEntityType(t: ContentEntityType): boolean {
  return ANON_ENTITY_TYPES.includes(t);
}

/* ───────────────────────────── cards ───────────────────────────── */

function universityCountryOf(userId: Id | null): string | null {
  if (!userId) return null;
  const row = prep('SELECT university_id FROM users WHERE id = ?').get(userId) as { university_id: Id } | undefined;
  return row ? (getUniversityRow(row.university_id)?.country_code ?? null) : null;
}

function unavailableCard(ref: ShareCardRef, viewerId: Id): ShareCard {
  return {
    kind: ref.kind, id: ref.id, title: 'No longer available', subtitle: null, imageUrl: null, href: '/', status: 'unavailable',
    price: null, currency: currencyFor(universityCountryOf(viewerId)), badge: null, ownerId: null, meetupSpot: null,
  };
}

/**
 * Never throws; missing / blocked / non-active owner → status 'unavailable', title 'No longer available'.
 * Resolvers apply their own status rules; foundation additionally applies the block rule (never for `buzz`), forces
 * `ownerId: null` for `buzz`, and fills `currency` from the owner's (else the viewer's) campus.
 */
export function resolveCard(ref: ShareCardRef, viewerId: Id): ShareCard {
  try {
    const resolver = cardResolvers.get(ref.kind);
    const resolved = resolver ? resolver(ref.id, viewerId) : null;
    if (!resolved) return unavailableCard(ref, viewerId);
    const ownerId = ref.kind === 'buzz' ? null : (resolved.ownerId ?? null);
    if (ownerId && ownerId !== viewerId) {
      const blocked = prep(
        'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)',
      ).get(viewerId, ownerId, ownerId, viewerId);
      if (blocked) return unavailableCard(ref, viewerId);
      const owner = prep('SELECT status FROM users WHERE id = ?').get(ownerId) as { status: string } | undefined;
      if (!owner || owner.status !== 'active') return unavailableCard(ref, viewerId);
    }
    const currency = currencyFor(universityCountryOf(ownerId) ?? universityCountryOf(viewerId));
    const card: ShareCard = {
      title: String(resolved.title ?? 'No longer available'),
      subtitle: resolved.subtitle ?? null,
      imageUrl: ref.kind === 'buzz' ? null : (resolved.imageUrl ?? null),
      href: resolved.href || '/',
      status: resolved.status ?? 'available',
      price: typeof resolved.price === 'number' && Number.isFinite(resolved.price) ? resolved.price : null,
      badge: resolved.badge ?? null,
      meetupSpot: resolved.meetupSpot ?? null,
      ownerId,
      kind: ref.kind,
      id: ref.id,
      currency,
    };
    return card;
  } catch (err) {
    log.error(`card resolver "${ref.kind}" failed`, err);
    return unavailableCard(ref, viewerId);
  }
}

/* ───────────────────────────── foundation: profile resolver + adapter ───────────────────────────── */

interface ProfileRow {
  id: Id;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  avatar_seed: string;
  account_type: 'student' | 'org';
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  university_id: Id;
  bio: string;
  is_verified: number;
  created_at: EpochMs;
  updated_at: EpochMs;
}

function profileRow(id: Id): ProfileRow | null {
  return (
    (prep(
      'SELECT id, handle, display_name, avatar_url, avatar_seed, account_type, status, university_id, bio, is_verified, created_at, updated_at FROM users WHERE id = ?',
    ).get(id) as ProfileRow | undefined) ?? null
  );
}

function avatarOf(row: ProfileRow): string {
  return row.avatar_url ?? `/api/avatars/${encodeURIComponent(row.avatar_seed)}.svg?t=${row.account_type}`;
}

/** `profile` card: the public profile (block + status rules applied by `resolveCard` through `ownerId`). */
const profileResolver: CardResolver = (id) => {
  const row = profileRow(id);
  if (!row || row.status !== 'active') return null;
  const uni = getUniversityRow(row.university_id);
  return {
    title: row.display_name,
    subtitle: `@${row.handle}${uni ? ` · ${uni.short_name}` : ''}`,
    imageUrl: avatarOf(row),
    href: `/u/${row.handle}`,
    status: 'available',
    price: null,
    badge: row.account_type === 'org' ? (row.is_verified === 1 ? 'Verified org' : 'Org') : null,
    ownerId: row.id,
    meetupSpot: null,
  };
};

const PROFILE_STATUS: Record<ProfileRow['status'], ContentStatus> = { active: 'active', suspended: 'hidden', banned: 'removed', deleted: 'deleted' };

/**
 * `profile` ContentAdapter (reports on a profile; the admin queue). Profiles have no status column of their own:
 * `setStatus('hidden' | 'removed')` blanks the offending profile text + custom avatar; account standing is a sanction
 * (staff.ts). `active` is a no-op. Profiles never auto-hide (`autoHideImmune: true`).
 */
const profileAdapter: ContentAdapter = {
  entityType: 'profile',
  load(id) {
    const row = profileRow(id);
    if (!row) return null;
    const fields = [{ field: 'name', text: row.display_name }];
    if (row.bio) fields.push({ field: 'bio', text: row.bio });
    return {
      entityType: 'profile', entityId: row.id, authorId: row.id, universityId: row.university_id, status: PROFILE_STATUS[row.status],
      surface: 'profile', anon: false, autoHideImmune: true, createdAt: row.created_at, label: 'profile', fields,
      media: row.avatar_url && row.avatar_url.startsWith('/uploads/') ? [{ url: row.avatar_url, kind: 'image' }] : [],
      href: `/u/${row.handle}`, parent: null,
    };
  },
  setStatus(id, status) {
    if (status === 'active') return;
    prep("UPDATE users SET bio = '', avatar_url = NULL, updated_at = ? WHERE id = ?").run(now(), id);
  },
};

registerCardResolver('profile', profileResolver);
registerContentAdapter(profileAdapter);

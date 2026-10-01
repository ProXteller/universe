/**
 * Buzz alias derivation — safety §5.1, exactly. SERVER-ONLY: the lists live here (never in shared/ or the client bundle);
 * the HMAC key is `config.buzzAliasSecret` and is used for nothing else.
 *
 *   digest     = HMAC-SHA256(secret, threadId + ':' + userId)   // UTF-8, exactly this message, no prefix
 *   nounIndex  = digest.readUInt16BE(0) % 64
 *   colorIndex = digest.readUInt16BE(2) % 12
 *
 * The alias is computed at serialization time and never stored. Collision suffixes ("Anon Comet 2") are assigned by the
 * thread serializer (see `aliasBook`): authors sharing (nounIndex, colorIndex) are ordered by the `created_at` of their
 * first post in the thread (ties by post id); the 2nd, 3rd … get a suffix.
 */
import crypto from 'node:crypto';
import type { Id } from '@shared/core';
import type { BuzzAlias } from '@shared/buzz';
import { config } from '../../config';

export const ALIAS_NOUNS: readonly { emoji: string; noun: string }[] = [
  { emoji: '☄️', noun: 'Comet' }, { emoji: '🌟', noun: 'Nova' }, { emoji: '🌌', noun: 'Nebula' }, { emoji: '🌙', noun: 'Moon' },
  { emoji: '🪐', noun: 'Saturn' }, { emoji: '🚀', noun: 'Rocket' }, { emoji: '🛰️', noun: 'Satellite' }, { emoji: '🌠', noun: 'Meteor' },
  { emoji: '☀️', noun: 'Sol' }, { emoji: '🌍', noun: 'Terra' }, { emoji: '🔭', noun: 'Scope' }, { emoji: '👽', noun: 'Alien' },
  { emoji: '🛸', noun: 'Saucer' }, { emoji: '🌑', noun: 'Eclipse' }, { emoji: '⭐', noun: 'Star' }, { emoji: '✨', noun: 'Spark' },
  { emoji: '🌀', noun: 'Vortex' }, { emoji: '⚡', noun: 'Bolt' }, { emoji: '🔥', noun: 'Ember' }, { emoji: '❄️', noun: 'Frost' },
  { emoji: '🌊', noun: 'Tide' }, { emoji: '🌪️', noun: 'Cyclone' }, { emoji: '🌈', noun: 'Prism' }, { emoji: '☁️', noun: 'Cloud' },
  { emoji: '🦊', noun: 'Fox' }, { emoji: '🦉', noun: 'Owl' }, { emoji: '🐺', noun: 'Wolf' }, { emoji: '🦅', noun: 'Falcon' },
  { emoji: '🐙', noun: 'Kraken' }, { emoji: '🐬', noun: 'Dolphin' }, { emoji: '🦋', noun: 'Moth' }, { emoji: '🐝', noun: 'Bee' },
  { emoji: '🦎', noun: 'Gecko' }, { emoji: '🐢', noun: 'Turtle' }, { emoji: '🦈', noun: 'Shark' }, { emoji: '🐼', noun: 'Panda' },
  { emoji: '🦁', noun: 'Lion' }, { emoji: '🐯', noun: 'Tiger' }, { emoji: '🐻', noun: 'Bear' }, { emoji: '🦌', noun: 'Stag' },
  { emoji: '🦜', noun: 'Parrot' }, { emoji: '🦩', noun: 'Flamingo' }, { emoji: '🦔', noun: 'Hedgehog' }, { emoji: '🦦', noun: 'Otter' },
  { emoji: '🌵', noun: 'Cactus' }, { emoji: '🍄', noun: 'Mushroom' }, { emoji: '🌻', noun: 'Sunflower' }, { emoji: '🍀', noun: 'Clover' },
  { emoji: '🌲', noun: 'Pine' }, { emoji: '🍁', noun: 'Maple' }, { emoji: '🌸', noun: 'Blossom' }, { emoji: '🥑', noun: 'Avocado' },
  { emoji: '🍋', noun: 'Lemon' }, { emoji: '🍉', noun: 'Melon' }, { emoji: '🥨', noun: 'Pretzel' }, { emoji: '🍩', noun: 'Donut' },
  { emoji: '🧊', noun: 'Cube' }, { emoji: '💎', noun: 'Gem' }, { emoji: '🎲', noun: 'Dice' }, { emoji: '🧭', noun: 'Compass' },
  { emoji: '🎧', noun: 'Headphones' }, { emoji: '🪁', noun: 'Kite' }, { emoji: '🔮', noun: 'Oracle' }, { emoji: '🗝️', noun: 'Key' },
];

export const ALIAS_COLORS: readonly string[] = [
  '#7C9BFF', '#5EEAD4', '#F472B6', '#FBBF24', '#A78BFA', '#34D399', '#FB7185', '#38BDF8', '#F97316', '#A3E635', '#E879F9', '#94A3B8',
];

export interface AliasKey {
  nounIndex: number;
  colorIndex: number;
}

/** The (nounIndex, colorIndex) pair for a user in a thread. Pure; never logged. */
export function aliasKey(threadId: Id, userId: Id): AliasKey {
  const digest = crypto.createHmac('sha256', config.buzzAliasSecret).update(`${threadId}:${userId}`, 'utf8').digest();
  return { nounIndex: digest.readUInt16BE(0) % ALIAS_NOUNS.length, colorIndex: digest.readUInt16BE(2) % ALIAS_COLORS.length };
}

export function aliasFromKey(key: AliasKey, suffix = 0): BuzzAlias {
  const noun = ALIAS_NOUNS[key.nounIndex]!;
  return {
    emoji: noun.emoji,
    label: `Anon ${noun.noun}${suffix > 0 ? ` ${suffix + 1}` : ''}`,
    color: ALIAS_COLORS[key.colorIndex]!,
  };
}

/** Feed cards (root only) never need collision handling. */
export function aliasFor(threadId: Id, userId: Id): BuzzAlias {
  return aliasFromKey(aliasKey(threadId, userId));
}

/**
 * Per-thread alias book with deterministic collision suffixes (safety §5.1 rule 2). `participants` = every distinct
 * author of the thread (any status; rows are soft-deleted only, so the order is stable), each with the `created_at`
 * and id of their FIRST post in the thread.
 */
export function aliasBook(threadId: Id, participants: { userId: Id; firstAt: number; firstId: Id }[]): Map<Id, BuzzAlias> {
  const ordered = [...participants].sort((a, b) => a.firstAt - b.firstAt || (a.firstId < b.firstId ? -1 : a.firstId > b.firstId ? 1 : 0));
  const seen = new Map<string, number>();
  const out = new Map<Id, BuzzAlias>();
  for (const p of ordered) {
    if (out.has(p.userId)) continue;
    const key = aliasKey(threadId, p.userId);
    const slot = `${key.nounIndex}:${key.colorIndex}`;
    const n = seen.get(slot) ?? 0;
    seen.set(slot, n + 1);
    out.set(p.userId, aliasFromKey(key, n));
  }
  return out;
}

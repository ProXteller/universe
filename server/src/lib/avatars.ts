/**
 * Offline generated avatars (SPEC §4.2.15, design §8.2): DiceBear `notionists` for students, `shapes` for orgs, on
 * the fixed set of eight deep tints. **Anonymous (Buzz) aliases never use this module.**
 */
import { createAvatar } from '@dicebear/core';
import { notionists, shapes } from '@dicebear/collection';
import type { AccountType } from '@shared/core';

/** design §8.2 — deep tints so faces sit calmly on the dark UI (hex without '#', as DiceBear expects). */
export const AVATAR_TINTS = ['1f2547', '2a1f47', '0f3340', '12382c', '3d2a14', '40202c', '25304a', '33204a'] as const;

const CACHE_MAX = 400;
const cache = new Map<string, string>();

export function renderAvatarSvg(seed: string, type: AccountType): string {
  const key = `${type}:${seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const options = { seed, backgroundColor: [...AVATAR_TINTS], backgroundType: ['solid' as const] };
  const svg = type === 'org' ? createAvatar(shapes, options).toString() : createAvatar(notionists, options).toString();
  cache.set(key, svg);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return svg;
}

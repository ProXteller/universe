/**
 * Local recent searches (T2: product §2.5 "recent searches stored locally and clearable"). Lives ONLY in this
 * browser under `uv:discover:recent` — never sent to the server; a query string only, never a user id.
 */
import { useCallback } from 'react';
import { DISCOVER_RECENTS_KEY, DISCOVER_RECENTS_MAX } from '@shared/discover';
import { useLocalStorage } from '@/lib/hooks';

export function useRecentSearches(): {
  recents: string[];
  add(q: string): void;
  remove(q: string): void;
  clear(): void;
} {
  const [recents, setRecents] = useLocalStorage<string[]>(DISCOVER_RECENTS_KEY, []);
  const add = useCallback(
    (q: string) => {
      const term = q.trim();
      if (!term) return;
      setRecents((prev) => [term, ...(Array.isArray(prev) ? prev : []).filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, DISCOVER_RECENTS_MAX));
    },
    [setRecents],
  );
  const remove = useCallback((q: string) => setRecents((prev) => (Array.isArray(prev) ? prev : []).filter((r) => r !== q)), [setRecents]);
  const clear = useCallback(() => setRecents([]), [setRecents]);
  return { recents: Array.isArray(recents) ? recents.filter((r) => typeof r === 'string') : [], add, remove, clear };
}

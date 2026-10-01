/**
 * `auth` slice seed (SPEC §5.1: "Seeds: none"). The slice owns no tables; the seed world it needs (users, follows,
 * invite codes, `invited_by`) is written by the core seed (`00-core.ts`). Intentionally a no-op at both scales.
 */
import type { SeedKit } from '../../lib/seedKit';

export default function seed(_kit: SeedKit): void {
  /* nothing to seed */
}

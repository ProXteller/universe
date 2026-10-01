/**
 * Frozen prop contracts for the slice entry exports (SPEC §4.6, R5). Every `features/<slice>/index.tsx` imports
 * its prop types from here and never redeclares them.
 */
import type { Id } from '@shared/core';

export interface HomePaneProps {
  active: boolean;
}

/** Embedded in the profile <Screen>; MUST NOT create its own scroll container. */
export interface UserContentProps {
  userId: Id;
  handle: string;
  isSelf: boolean;
}

export interface GuidelinesContentProps {
  variant?: 'page' | 'sheet';
  anchor?: string;
}

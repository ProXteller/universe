/** Zod fragments shared by the admin sub-routers. */
import { z } from 'zod';
import type { ModerationCategory, ModerationSurface } from '@shared/core';
import { CATEGORY_LABELS, SURFACE_GROUP } from '@shared/core';
import { STAFF_ACTIONS, UNMASK_REASON_CODES } from '@shared/admin';

export const CATEGORY_IDS = Object.keys(CATEGORY_LABELS) as [ModerationCategory, ...ModerationCategory[]];
export const SURFACE_IDS = Object.keys(SURFACE_GROUP) as [ModerationSurface, ...ModerationSurface[]];
export const STAFF_ACTION_IDS = STAFF_ACTIONS.map((a) => a.id) as [string, ...string[]];

export const zCategory = z.enum(CATEGORY_IDS);
export const zSurface = z.enum(SURFACE_IDS);
export const zStaffAction = z.enum(STAFF_ACTION_IDS);
export const zUnmaskReason = z.enum(UNMASK_REASON_CODES);
export const zId = z.string().min(1).max(64);
export const zNote = z.string().max(2000).optional();
export const idParams = z.object({ id: zId });

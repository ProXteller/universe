import type { AuthedUser } from '../lib/users';

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireAuth` / `optionalAuth` (SPEC §4.2.5). */
      user?: AuthedUser;
      /** `sessions.id` of the cookie session behind `req.user`. */
      sessionId?: string;
    }
  }
}

export {};

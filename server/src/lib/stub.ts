/**
 * Helpers for the foundation build-out (DECISIONS D1): lane S-M1 ships compiling stubs for the modules that lanes
 * S-M2a / S-M2b / S-M3 implement. A stub body calls `notImplemented('<name>')`; foundation code that fires optional
 * side effects into such a module wraps the call in `soft()` so M1 flows keep working until the real body lands.
 * Once every stub is implemented this file is dead code and can be deleted.
 */
import { ApiError } from './http';

export const NOT_IMPLEMENTED = 'not_implemented';

export function notImplemented(what: string): never {
  throw new ApiError(501, NOT_IMPLEMENTED, `${what} is not implemented yet`);
}

export function isNotImplemented(err: unknown): boolean {
  return err instanceof ApiError && err.status === 501 && err.code === NOT_IMPLEMENTED;
}

/** Runs `fn`; swallows ONLY the 501 of an unfinished stub. Every other error propagates. */
export function soft<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    if (isNotImplemented(err)) return undefined;
    throw err;
  }
}

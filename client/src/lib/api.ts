/**
 * The one HTTP client (SPEC §4.4.1 `lib/api.ts`). Every request to the API goes through here — except
 * `lib/analytics.ts`, which deliberately uses a raw `fetch` / `sendBeacon` so the global handlers below can
 * never fire from a tracking call.
 *
 * Global handling:
 *   401                      → session reset + redirect `/welcome?next=<path>`
 *   403 `onboarding_required` → `/welcome` (the auth flow resumes at the right step)
 *   403 `suspended`/`banned`  → session flipped to `'restricted'` (AppShell mounts the SanctionGate)
 *   403 `buzz_gate_required`  → left to the buzz slice
 * While `location.pathname` starts with `/welcome` (or is `/legal/*`, `/guidelines`) neither the 401 nor the
 * `onboarding_required` redirect is performed: the error is simply thrown to the caller.
 */
import { API_BASE } from '@shared/core';
import type { ApiErrorBody, MeUser } from '@shared/core';
import { useSessionStore } from '@/stores/session';
import { currentPathWithSearch, currentPathname, isRedirectExemptPath, navigateTo } from './navigation';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export class ApiClientError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(e: unknown, code?: string): e is ApiClientError {
  if (!(e instanceof ApiClientError)) return false;
  return code === undefined || e.code === code;
}

const FALLBACK_MESSAGE = 'Something went wrong. Try again.';
const OFFLINE_MESSAGE = "You're offline. Check your connection and try again.";

/** A user-safe message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_MESSAGE;
  if (e instanceof ApiClientError) return e.status >= 500 || !e.message ? FALLBACK_MESSAGE : e.message;
  return FALLBACK_MESSAGE;
}

/* ------------------------------------------------------------------ request plumbing */

export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

function apiUrl(path: string, query?: Query): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}${buildQuery(query)}`;
}

async function parseError(res: Response): Promise<ApiClientError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    body = null;
  }
  const err = body?.error;
  return new ApiClientError(
    res.status,
    err?.code ?? (res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'internal' : 'bad_request'),
    err?.message ?? (res.status >= 500 ? FALLBACK_MESSAGE : res.statusText || FALLBACK_MESSAGE),
    err?.details,
  );
}

let restrictedRefresh: Promise<void> | null = null;

/** Re-reads `/me` after a 403 suspended/banned so the SanctionGate has the sanction details. Never throws. */
function refreshRestrictedMe(): void {
  if (restrictedRefresh) return;
  restrictedRefresh = fetch(apiUrl('/me'), { credentials: 'include', headers: { Accept: 'application/json' } })
    .then(async (res) => {
      if (!res.ok) return;
      const me = (await res.json()) as MeUser;
      useSessionStore.getState().setMe(me);
    })
    .catch(() => undefined)
    .finally(() => {
      restrictedRefresh = null;
    });
}

export interface RequestOptions {
  /** Skip the global 401 / 403 handling (foundation-internal: the boot `/me` probe). */
  silent?: boolean;
  signal?: AbortSignal;
}

/** Applies the global handlers to an error. Returns the same error so callers can `throw applyGlobalHandlers(e)`. */
export function applyGlobalHandlers(err: ApiClientError, opts?: RequestOptions): ApiClientError {
  if (opts?.silent) return err;
  const exempt = isRedirectExemptPath();
  if (err.status === 401) {
    useSessionStore.getState().setAnon();
    if (!exempt) {
      const path = currentPathWithSearch();
      const next = path === '/' ? '' : `?next=${encodeURIComponent(path)}`;
      navigateTo(`/welcome${next}`, { replace: true });
    }
    return err;
  }
  if (err.status === 403) {
    if (err.code === 'onboarding_required') {
      if (!exempt && currentPathname() !== '/welcome') navigateTo('/welcome', { replace: true });
    } else if (err.code === 'suspended' || err.code === 'banned') {
      useSessionStore.getState().markRestricted(err.code);
      refreshRestrictedMe();
    }
  }
  return err;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Query,
  opts?: RequestOptions,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { method, headers, body: payload, credentials: 'include', signal: opts?.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiClientError(0, 'network', OFFLINE_MESSAGE);
  }
  if (!res.ok) throw applyGlobalHandlers(await parseError(res), opts);
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * `path` is relative to `/api` (`'/market/listings'`). Queries drop `undefined` / `null` / `''`. 204 → `undefined`.
 * A trailing options argument (foundation-internal) can silence the global handlers.
 */
export const api = {
  get<T>(path: string, query?: Query, opts?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, query, opts);
  },
  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, undefined, opts);
  },
  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PUT', path, body, undefined, opts);
  },
  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, undefined, opts);
  },
  delete<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, body, undefined, opts);
  },
};

/**
 * Multipart upload with progress (XHR — `fetch` has no upload progress). Same credentials, same error shape,
 * same global handlers as `api.*`. Used by `lib/upload.ts` only.
 */
export function apiUpload<T>(
  path: string,
  form: FormData,
  opts?: { onProgress?(p: number): void; signal?: AbortSignal },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(path));
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && opts?.onProgress) opts.onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onerror = () => reject(new ApiClientError(0, 'network', OFFLINE_MESSAGE));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      const text = typeof xhr.response === 'string' ? xhr.response : '';
      if (xhr.status >= 200 && xhr.status < 300) {
        opts?.onProgress?.(1);
        resolve((text ? JSON.parse(text) : undefined) as T);
        return;
      }
      let body: ApiErrorBody | null = null;
      try {
        body = text ? (JSON.parse(text) as ApiErrorBody) : null;
      } catch {
        body = null;
      }
      const err = new ApiClientError(
        xhr.status,
        body?.error?.code ?? (xhr.status >= 500 ? 'internal' : 'bad_request'),
        body?.error?.message ?? FALLBACK_MESSAGE,
        body?.error?.details,
      );
      reject(applyGlobalHandlers(err));
    };
    if (opts?.signal) {
      if (opts.signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      opts.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(form);
  });
}

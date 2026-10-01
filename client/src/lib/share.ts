/**
 * Share entry points (SPEC §4.4.1 `lib/share.ts`). The ShareSheet host lives in `components/ShareHost`.
 */
import type { ShareCardRef } from '@shared/core';
import type { SurfaceMode } from '@/ui';
import { useUiStore } from '@/stores/ui';
import { toast } from './toast';

export interface OpenShareInput {
  card: ShareCardRef;
  /** In-app path or absolute URL — `absoluteUrl()` is applied when copying / native-sharing. */
  url: string;
  title: string;
  /** For `navigator.share` only — never sent as a chat caption. */
  text?: string;
  /** Surface of the caller (Buzz passes 'incognito' so the sheet keeps the anonymous chrome, like `openReport`). */
  mode?: SurfaceMode;
}

export function openShare(input: OpenShareInput): void {
  useUiStore.getState().openShare(input);
}

/** `'/market/abc'` → `'https://host/market/abc'` (absolute inputs pass through). */
export function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window === 'undefined') return path;
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Copies the absolute URL and toasts "Link copied". */
export async function copyLink(url: string): Promise<void> {
  const ok = await writeClipboard(absoluteUrl(url));
  if (ok) toast.success('Link copied');
  else toast.error("Couldn't copy the link.");
}

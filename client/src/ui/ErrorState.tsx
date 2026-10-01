import { forwardRef } from 'react';
import { CloudOff, RotateCw, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { StateDisc } from './EmptyState';

export interface ErrorStateProps {
  /** Default "Couldn't load this". Write "Couldn't load {thing}". */
  title?: string;
  /** Anything thrown. Only API errors (`status` + `code`) are shown verbatim; the rest get a friendly fallback. */
  error?: unknown;
  onRetry?(): void;
  /** Single row with a retry link — failed pagination at the bottom of a list. */
  inline?: boolean;
  className?: string;
}

const FALLBACK = 'Something went wrong. Try again.';
const OFFLINE = "You're offline. Check your connection and try again.";

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** `ApiClientError` carries a server-written, user-safe message; a raw `TypeError: Failed to fetch` does not. */
function userSafeMessage(error: unknown): string {
  if (isOffline()) return OFFLINE;
  if (typeof error === 'object' && error !== null) {
    const e = error as { status?: unknown; code?: unknown; message?: unknown };
    if (typeof e.status === 'number' && typeof e.code === 'string' && typeof e.message === 'string' && e.message) {
      return e.status >= 500 ? FALLBACK : e.message;
    }
  }
  return FALLBACK;
}

export const ErrorState = forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  { title = "Couldn't load this", error, onRetry, inline = false, className },
  ref,
) {
  const message = userSafeMessage(error);

  if (inline) {
    return (
      <div ref={ref} role="alert" className={cn('flex min-h-14 w-full items-center gap-3 px-4 py-2', className)}>
        <TriangleAlert size={18} strokeWidth={1.75} aria-hidden className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1 truncate type-footnote text-ink-2">{title}</p>
        {onRetry ? (
          <Button variant="ghost" size="sm" leftIcon={RotateCw} onClick={onRetry} className="text-accent-ink hover:text-accent-ink">
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={ref} role="alert" className={cn('flex w-full flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center', className)}>
      <StateDisc icon={isOffline() ? CloudOff : TriangleAlert} tone="danger" />
      <div className="flex flex-col items-center gap-1.5">
        <h2 className="line-clamp-2 type-title-2 text-ink">{title}</h2>
        <p className="line-clamp-3 max-w-[280px] type-body text-ink-2">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" leftIcon={RotateCw} onClick={onRetry} className="mt-1">
          Retry
        </Button>
      ) : null}
    </div>
  );
});

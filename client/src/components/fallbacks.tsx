/**
 * Route-level fallbacks (SPEC §4.4.2): `PageLoader` (Suspense), `RouteError` (error boundary), `NotFound`.
 */
import { Component, forwardRef, type ErrorInfo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Orbit } from 'lucide-react';
import { EmptyState, ErrorState, Screen, Skeleton } from '@/ui';
import { cn } from '@/lib/cn';
import { routes } from '@/lib/links';

export interface PageLoaderProps {
  className?: string;
}

/** Skeleton geometry of a generic screen (header + three rows) — never a spinner. */
export const PageLoader = forwardRef<HTMLDivElement, PageLoaderProps>(function PageLoader({ className }, ref) {
  return (
    <div
      ref={ref}
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className={cn('absolute inset-0 flex flex-col gap-4 bg-canvas px-4', className)}
      style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}
    >
      <div className="flex items-center gap-3">
        <Skeleton circle w={40} h={40} />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton w="45%" h={14} />
          <Skeleton w="30%" h={10} />
        </div>
      </div>
      <Skeleton w="100%" h={148} className="rounded-lg" />
      <Skeleton w="100%" h={72} className="rounded-lg" />
      <Skeleton w="100%" h={72} className="rounded-lg" />
    </div>
  );
});

export interface RouteErrorProps {
  children: ReactNode;
  /** Optional title for the error screen ("Couldn't load Messages"). */
  title?: string;
}

interface RouteErrorState {
  error: unknown;
}

function isChunkLoadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /dynamically imported module|Loading chunk|Importing a module script failed|Failed to fetch/i.test(msg);
}

/**
 * Error boundary around every lazy route. "Try again" remounts the subtree; a failed chunk load (stale deploy)
 * reloads the page instead, which is the only thing that fixes it.
 */
export class RouteError extends Component<RouteErrorProps, RouteErrorState> {
  state: RouteErrorState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteErrorState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) console.error('Route error', error, info.componentStack);
  }

  private retry = () => {
    if (isChunkLoadError(this.state.error)) {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center px-4">
          <ErrorState title={this.props.title ?? "Couldn't load this screen"} error={this.state.error} onRetry={this.retry} />
        </div>
      </Screen>
    );
  }
}

export interface NotFoundProps {
  /** Default "Lost in space". */
  title?: string;
  description?: string;
  className?: string;
}

/** The 404 screen — also what non-staff see on `/admin/*`. */
export const NotFound = forwardRef<HTMLDivElement, NotFoundProps>(function NotFound(
  { title = 'Lost in space', description = "That page doesn't exist, or it drifted off.", className },
  ref,
) {
  const navigate = useNavigate();
  return (
    <Screen ref={ref} className={className}>
      <div className="flex flex-1 items-center justify-center px-4">
        <EmptyState
          icon={Orbit}
          title={title}
          description={description}
          action={{ label: 'Back to Home', onClick: () => navigate(routes.home(), { replace: true }) }}
        />
      </div>
    </Screen>
  );
});

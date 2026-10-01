import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

export interface CardProps {
  /**
   * `flat` (default: surface-1 + border) · `raised` (surface-2 + hairline) · `hero` (soft gradient + accent
   * border; max one per screen) · `media` (p-0, overflow hidden, image on top).
   */
  variant?: 'flat' | 'raised' | 'hero' | 'media';
  /** Press scale + hover border. Implied by `to` / `onClick`. */
  interactive?: boolean;
  /** Renders a router `<Link>`. */
  to?: string;
  /** Renders a `<button>`. */
  onClick?(): void;
  'aria-label'?: string;
  className?: string;
  children?: ReactNode;
}

const variants = {
  flat: 'border border-line bg-surface-1 p-4',
  raised: 'border border-line bg-surface-2 p-4 inset-shadow-hairline',
  hero: 'border border-accent-line bg-surface-1 bg-hero-soft p-4',
  media: 'overflow-hidden border border-line bg-surface-1 p-0',
} as const;

const CardRoot = forwardRef<HTMLElement, CardProps>(function Card(
  { variant = 'flat', interactive, to, onClick, 'aria-label': ariaLabel, className, children },
  ref,
) {
  const pressable = interactive ?? Boolean(to || onClick);
  const classes = cn(
    'relative block w-full min-w-0 rounded-lg text-left text-ink',
    variants[variant],
    pressable && 'press cursor-pointer hover:border-line-strong',
    className,
  );
  if (to !== undefined) {
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} to={to} onClick={onClick} aria-label={ariaLabel} draggable={false} className={classes}>
        {children}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button ref={ref as Ref<HTMLButtonElement>} type="button" onClick={onClick} aria-label={ariaLabel} className={classes}>
        {children}
      </button>
    );
  }
  return (
    <div ref={ref as Ref<HTMLDivElement>} aria-label={ariaLabel} className={classes}>
      {children}
    </div>
  );
});

type PartProps = HTMLAttributes<HTMLDivElement>;

const CardHeader = forwardRef<HTMLDivElement, PartProps>(function CardHeader({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('mb-3 flex items-center gap-3', className)} {...rest} />;
});

const CardBody = forwardRef<HTMLDivElement, PartProps>(function CardBody({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('min-w-0', className)} {...rest} />;
});

const CardFooter = forwardRef<HTMLDivElement, PartProps>(function CardFooter({ className, ...rest }, ref) {
  return <div ref={ref} className={cn('mt-4 flex items-center gap-2 border-t border-line-subtle pt-3', className)} {...rest} />;
});

/**
 * `<Card>` + `Card.Header / Card.Body / Card.Footer`. In-list cards never carry shadows.
 * Inside `variant="media"` the parts need their own padding (`className="p-4"`).
 */
export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody, Footer: CardFooter });

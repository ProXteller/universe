import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface FieldProps {
  /** id of the control (label `htmlFor`). Omit for button-like controls and pass `labelId` instead. */
  htmlFor?: string;
  labelId?: string;
  label?: ReactNode;
  helper?: ReactNode;
  error?: ReactNode;
  /** id for the helper / error line (wire to `aria-describedby`). */
  messageId: string;
  /** Right-aligned extra on the message line (character counter). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Shared field chrome (design §5.2): label 6px above, control, then helper OR error. Internal to the kit. */
export function Field({ htmlFor, labelId, label, helper, error, messageId, aside, className, children }: FieldProps) {
  const message = error || helper;
  return (
    <div className={cn('flex w-full min-w-0 flex-col', className)}>
      {label ? (
        <label id={labelId} htmlFor={htmlFor} className="mb-1.5 type-footnote text-ink-2">
          {label}
        </label>
      ) : null}
      {children}
      {message || aside ? (
        <div className="mt-1.5 flex items-start gap-2">
          {message ? (
            <p
              id={messageId}
              role={error ? 'alert' : undefined}
              className={cn('flex min-w-0 flex-1 items-start gap-1.5 type-footnote', error ? 'text-danger' : 'text-ink-3')}
            >
              {error ? <CircleAlert size={14} strokeWidth={2} aria-hidden className="mt-0.5 shrink-0" /> : null}
              <span className="min-w-0">{message}</span>
            </p>
          ) : (
            <span className="flex-1" />
          )}
          {aside}
        </div>
      ) : null}
    </div>
  );
}

/** Control chrome shared by Input, Textarea and the Select trigger. */
export const controlChrome =
  'border border-line bg-surface-2 inset-shadow-hairline transition-[border-color,box-shadow] duration-150 ease-out ' +
  'hover:border-line-strong focus-within:border-accent-line focus-within:ring-3 focus-within:ring-accent-soft';
export const controlInvalid = 'border-danger/60 hover:border-danger/60 focus-within:border-danger/60 focus-within:ring-danger-soft';

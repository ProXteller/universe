import { forwardRef } from 'react';
import { APP_NAME, APP_WORDMARK_SPLIT } from '@shared/core';
import { cn } from '@/lib/cn';

export interface WordmarkProps {
  size?: 'sm' | 'md' | 'lg' | 'display';
  className?: string;
}

const SIZE: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'type-title-3',
  md: 'type-title-2',
  lg: 'type-title-1',
  display: 'type-display',
};

/** `uni` regular + `verse` bold, lowercase, Sora — the only way the name is rendered. */
export const Wordmark = forwardRef<HTMLSpanElement, WordmarkProps>(function Wordmark({ size = 'md', className }, ref) {
  const name = APP_NAME.toLowerCase();
  return (
    <span ref={ref} aria-label={APP_NAME} className={cn('inline-flex items-baseline text-ink select-none', SIZE[size], className)}>
      <span className="font-normal">{name.slice(0, APP_WORDMARK_SPLIT)}</span>
      <span className="font-bold">{name.slice(APP_WORDMARK_SPLIT)}</span>
    </span>
  );
});

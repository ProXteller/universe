import type { FC } from 'react';

export interface HighlightProps {
  text: string;
  /** Case-insensitive substring to emphasise; empty → plain text. */
  query: string;
  className?: string;
}

/** Wraps the first case-insensitive occurrence of `query` in a `<mark>`-like accent span. */
export const Highlight: FC<HighlightProps> = ({ text, query, className }) => {
  const q = query.trim().toLowerCase();
  if (!q) return <span className={className}>{text}</span>;
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return <span className={className}>{text}</span>;
  return (
    <span className={className}>
      {text.slice(0, idx)}
      <span className="rounded-xs bg-accent-soft text-ink">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </span>
  );
};

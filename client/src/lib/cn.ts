import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge has to know about the tokens theme.css adds, otherwise it misreads them:
 * `text-md` / `text-2xs` would be treated as text COLOURS (and silently dropped next to `text-ink`),
 * `shadow-glow` as a shadow colour, and two `type-*` roles would both survive a merge.
 */
const twMerge = extendTailwindMerge<'type-role'>({
  extend: {
    theme: {
      text: ['2xs', 'md'],
      shadow: ['glow', 'frame'],
      'inset-shadow': ['hairline'],
    },
    classGroups: {
      'type-role': [
        {
          type: [
            'display', 'title-1', 'title-2', 'title-3', 'headline', 'body-lg', 'body',
            'footnote', 'caption', 'micro', 'overline', 'label', 'label-sm',
          ],
        },
      ],
    },
  },
});

/** clsx + tailwind-merge. `className` passed by a caller always goes last so it wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

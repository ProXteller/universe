/**
 * The content of a root buzz: optional title, text (or its placeholder) and media. Shared by the feed card and the
 * thread page. A placeholder (hidden / removed / deleted for other viewers) arrives with no title and no media.
 */
import { useState, type FC } from 'react';
import type { MediaImage } from '@shared/core';
import type { Buzz, BuzzMedia } from '@shared/buzz';
import { Lightbox } from '@/ui';
import { MediaBox } from '@/components';
import { cn } from '@/lib/cn';
import { BuzzText } from './parts';

export const BuzzTitle: FC<{ title: string; large?: boolean; className?: string }> = ({ title, large, className }) => (
  <h3 className={cn(large ? 'type-title-3' : 'type-headline', 'break-words text-ink', className)}>{title}</h3>
);

/** Title + text; the text is skipped when a titled buzz has no body. */
export const BuzzContent: FC<{ buzz: Buzz; clamp?: boolean; large?: boolean }> = ({ buzz, clamp, large }) => (
  <div className="flex flex-col gap-1.5">
    {buzz.title ? <BuzzTitle title={buzz.title} large={large} /> : null}
    {buzz.text || !buzz.title ? <BuzzText text={buzz.text} status={buzz.status} clamp={clamp} large={large} /> : null}
  </div>
);

function aspectOf(m: BuzzMedia, fallback: number): number {
  if (m.width && m.height && m.width > 0 && m.height > 0) return Math.min(1.78, Math.max(0.75, m.width / m.height));
  return fallback;
}

/** Up to four photos (1 / 2 / 3 / 4 layouts, tap → Lightbox) or one video with native controls. */
export const BuzzMediaView: FC<{ media: BuzzMedia[]; className?: string }> = ({ media, className }) => {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (media.length === 0) return null;

  const video = media.find((m) => m.type === 'video');
  if (video) {
    return (
      <div
        className={cn('relative overflow-hidden rounded-lg bg-surface-2', className)}
        style={{ aspectRatio: String(aspectOf(video, 16 / 9)) }}
        data-no-pager-drag
        onClick={(e) => e.stopPropagation()}
      >
        {/* `#t=0.1` makes mobile Safari paint the first frame as the poster */}
        <video src={`${video.url}#t=0.1`} controls playsInline preload="metadata" className="absolute inset-0 size-full bg-surface-2 object-contain" aria-label="Video" />
      </div>
    );
  }

  const images: MediaImage[] = media.filter((m) => m.type === 'image').slice(0, 4).map((m) => ({ url: m.url, width: m.width, height: m.height }));
  const n = images.length;
  const openAt = (i: number): void => {
    setIndex(i);
    setOpen(true);
  };
  const tile = (i: number, aspect: number, extra?: string) => (
    <MediaBox key={i} src={images[i]!.url} alt={`Photo ${i + 1} of ${n}`} aspect={aspect} rounded="none" onClick={() => openAt(i)} className={cn('h-full', extra)} />
  );

  let grid;
  if (n === 1) grid = tile(0, aspectOf(media[0]!, 4 / 3));
  else if (n === 2) grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1].map((i) => tile(i, 0.8))}</div>;
  else if (n === 3)
    grid = (
      <div className="grid grid-cols-2 grid-rows-2 gap-0.5">
        {tile(0, 0.5, 'row-span-2')}
        {tile(1, 1)}
        {tile(2, 1)}
      </div>
    );
  else grid = <div className="grid grid-cols-2 gap-0.5">{[0, 1, 2, 3].map((i) => tile(i, 1))}</div>;

  return (
    <>
      <div className={cn('overflow-hidden rounded-lg bg-surface-2', className)} data-no-pager-drag onClick={(e) => e.stopPropagation()}>
        {grid}
      </div>
      <div className="contents" onClick={(e) => e.stopPropagation()}>
        <Lightbox open={open} onOpenChange={setOpen} images={images} index={index} onIndexChange={setIndex} />
      </div>
    </>
  );
};

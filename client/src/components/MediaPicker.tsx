import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, RotateCw, X } from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { Avatar, IconButton, ProgressBar } from '@/ui';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/api';
import { toast } from '@/lib/toast';
import { toMediaImage, uploadImage } from '@/lib/upload';
import { useMeOptional } from '@/lib/session';

export interface MediaPickerProps {
  value: MediaImage[];
  onChange(v: MediaImage[]): void;
  max: number;
  /** `tray` = horizontal 96px tiles (composers) · `grid` = 3-col (listings) · `avatar` = single round tile. */
  variant?: 'tray' | 'grid' | 'avatar';
  /** First tile = cover + a "Make cover" action on the others. */
  coverLabel?: boolean;
  disabled?: boolean;
  hint?: string;
  onUploadingChange?(busy: boolean): void;
  className?: string;
}

interface PendingTile {
  key: string;
  file: File;
  previewUrl: string;
  progress: number;
  error: string | null;
}

let keySeq = 0;

/** Images only; `prepareImage` + `uploadImage` per file, per-tile progress / retry / remove. */
export const MediaPicker = forwardRef<HTMLDivElement, MediaPickerProps>(function MediaPicker(
  { value, onChange, max, variant = 'tray', coverLabel = false, disabled = false, hint, onUploadingChange, className },
  ref,
) {
  const me = useMeOptional();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<PendingTile[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const busy = pending.some((p) => p.error === null);
  useEffect(() => onUploadingChange?.(busy), [busy, onUploadingChange]);
  useEffect(
    () => () => {
      pending.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const kind = variant === 'avatar' ? 'avatar' : 'image';

  const run = useCallback(
    async (tile: PendingTile) => {
      try {
        const res = await uploadImage(tile.file, {
          kind,
          onProgress: (p) => setPending((list) => list.map((t) => (t.key === tile.key ? { ...t, progress: p } : t))),
        });
        setPending((list) => list.filter((t) => t.key !== tile.key));
        URL.revokeObjectURL(tile.previewUrl);
        const next = variant === 'avatar' ? [toMediaImage(res)] : [...valueRef.current, toMediaImage(res)].slice(0, max);
        onChangeRef.current(next);
      } catch (e) {
        setPending((list) => list.map((t) => (t.key === tile.key ? { ...t, error: errorMessage(e) } : t)));
      }
    },
    [kind, max, variant],
  );

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = variant === 'avatar' ? 1 : Math.max(0, max - valueRef.current.length - pending.length);
    const picked = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, room);
    if (picked.length === 0) {
      if (room === 0) toast.info(`You can add up to ${max} photos.`);
      return;
    }
    const tiles: PendingTile[] = picked.map((file) => ({
      key: `p${++keySeq}`,
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
      error: null,
    }));
    setPending((list) => (variant === 'avatar' ? tiles : [...list, ...tiles]));
    tiles.forEach((t) => void run(t));
  };

  const retry = (tile: PendingTile) => {
    setPending((list) => list.map((t) => (t.key === tile.key ? { ...t, error: null, progress: 0 } : t)));
    void run({ ...tile, error: null, progress: 0 });
  };
  const cancel = (tile: PendingTile) => {
    setPending((list) => list.filter((t) => t.key !== tile.key));
    URL.revokeObjectURL(tile.previewUrl);
  };
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const makeCover = (i: number) => {
    const next = [...value];
    const [img] = next.splice(i, 1);
    if (img) onChange([img, ...next]);
  };

  const canAdd = !disabled && (variant === 'avatar' || value.length + pending.length < max);

  // Proxied by the labelled buttons below (`inputRef.current?.click()`): out of the tab order and the a11y tree,
  // so keyboard / screen-reader users never land on an unnamed file control.
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple={variant !== 'avatar'}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      disabled={!canAdd}
      onChange={(e) => {
        addFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  if (variant === 'avatar') {
    const current = pending[0];
    const src = current?.previewUrl ?? value[0]?.url ?? null;
    return (
      <div ref={ref} className={cn('flex flex-col items-center gap-2', className)}>
        {input}
        <button
          type="button"
          disabled={!canAdd}
          onClick={() => inputRef.current?.click()}
          aria-label={src ? 'Change photo' : 'Add a photo'}
          className="press relative rounded-full"
        >
          <Avatar src={src} name={me?.displayName ?? 'You'} size="2xl" />
          <span className="absolute right-0 bottom-0 flex size-9 items-center justify-center rounded-full bg-accent text-on-accent ring-4 ring-canvas">
            <Camera size={16} strokeWidth={2} aria-hidden />
          </span>
          {current && current.error === null ? (
            <span className="absolute inset-x-3 -bottom-3">
              <ProgressBar value={current.progress} className="motion-safe-keep" />
            </span>
          ) : null}
        </button>
        {current?.error ? (
          <div className="flex items-center gap-2 type-caption text-danger">
            <span>{current.error}</span>
            <button type="button" className="underline" onClick={() => retry(current)}>
              Retry
            </button>
            <button type="button" className="underline" onClick={() => cancel(current)}>
              Cancel
            </button>
          </div>
        ) : hint ? (
          <p className="type-caption text-ink-3">{hint}</p>
        ) : null}
      </div>
    );
  }

  const tile = variant === 'grid' ? 'aspect-square w-full' : 'size-24 shrink-0';

  return (
    <div ref={ref} className={cn('flex flex-col gap-2', className)}>
      {input}
      <div className={cn(variant === 'grid' ? 'grid grid-cols-3 gap-2' : 'scroll-x flex gap-2 pb-1')}>
        {value.map((img, i) => (
          <div key={`${img.url}-${i}`} className={cn('relative overflow-hidden rounded-md bg-surface-2', tile)}>
            <img src={img.url} alt={img.alt ?? ''} className="size-full object-cover" draggable={false} />
            {coverLabel && i === 0 ? (
              <span className="absolute bottom-1 left-1 rounded-xs bg-black/60 px-1.5 py-0.5 type-micro text-white">Cover</span>
            ) : null}
            {coverLabel && i > 0 && !disabled ? (
              <button
                type="button"
                onClick={() => makeCover(i)}
                className="absolute bottom-1 left-1 rounded-xs bg-black/60 px-1.5 py-0.5 type-micro text-white"
              >
                Make cover
              </button>
            ) : null}
            {!disabled ? (
              <IconButton
                icon={X}
                aria-label="Remove photo"
                size="sm"
                variant="glass"
                onClick={() => remove(i)}
                className="absolute top-1 right-1 size-7"
              />
            ) : null}
          </div>
        ))}
        {pending.map((p) => (
          <div key={p.key} className={cn('relative overflow-hidden rounded-md bg-surface-2', tile)}>
            <img src={p.previewUrl} alt="" className={cn('size-full object-cover', p.error ? 'opacity-40' : 'opacity-70')} draggable={false} />
            {p.error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 p-1 text-center">
                <span className="line-clamp-2 type-micro text-white">{p.error}</span>
                <div className="flex gap-1">
                  <IconButton icon={RotateCw} aria-label="Retry upload" size="sm" variant="glass" onClick={() => retry(p)} className="size-7" />
                  <IconButton icon={X} aria-label="Cancel upload" size="sm" variant="glass" onClick={() => cancel(p)} className="size-7" />
                </div>
              </div>
            ) : (
              <div className="absolute inset-x-2 bottom-2">
                <ProgressBar value={p.progress} aria-label="Uploading" className="motion-safe-keep" />
              </div>
            )}
          </div>
        ))}
        {canAdd ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label={`Add photos, ${value.length + pending.length} of ${max}`}
            className={cn(
              'press flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong bg-surface-1 text-ink-3 hover:text-ink',
              tile,
            )}
          >
            <ImagePlus size={22} strokeWidth={1.75} aria-hidden />
            <span className="type-micro">
              {value.length + pending.length}/{max}
            </span>
          </button>
        ) : null}
      </div>
      {hint ? <p className="type-caption text-ink-3">{hint}</p> : null}
    </div>
  );
});

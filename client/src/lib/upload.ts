/**
 * Upload helpers (SPEC §4.4.1 `lib/upload.ts`). Images are re-encoded on a canvas before upload; videos are
 * probed for duration / size and a first-frame poster. Both post to `POST /uploads` (#29) with progress.
 */
import { LIMITS } from '@shared/core';
import type { MediaImage, UploadResult } from '@shared/core';
import { ApiClientError, apiUpload } from './api';

export interface PreparedImage {
  blob: Blob;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this image.'));
    img.src = src;
  });
}

async function decode(file: File): Promise<{ width: number; height: number; draw(ctx: CanvasRenderingContext2D, w: number, h: number): void; release(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
        release: () => bmp.close(),
      };
    } catch {
      /* fall through */
    }
  }
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    release: () => URL.revokeObjectURL(url),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode this image.'))), type, quality);
  });
}

/** Canvas re-encode: strips EXIF, caps the long edge (default 2048), JPEG 0.86 (or WebP). */
export async function prepareImage(
  file: File,
  opts?: { maxEdge?: number; type?: 'image/jpeg' | 'image/webp' },
): Promise<PreparedImage> {
  const maxEdge = opts?.maxEdge ?? 2048;
  const type = opts?.type ?? 'image/jpeg';
  const src = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const width = Math.max(1, Math.round(src.width * scale));
    const height = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process this image.');
    if (type === 'image/jpeg') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }
    src.draw(ctx, width, height);
    const blob = await canvasToBlob(canvas, type, 0.86);
    return { blob, width, height };
  } finally {
    src.release();
  }
}

/** `prepareImage` → multipart `POST /uploads` (`kind` image | avatar) with progress. */
export async function uploadImage(
  file: File,
  opts?: { kind?: 'image' | 'avatar'; onProgress?(p: number): void },
): Promise<UploadResult> {
  const kind = opts?.kind ?? 'image';
  const prepared = await prepareImage(file, kind === 'avatar' ? { maxEdge: 1024 } : undefined);
  if (prepared.blob.size > LIMITS.imageMaxBytes) {
    throw new ApiClientError(413, 'payload_too_large', 'That image is too large. Try one under 8 MB.');
  }
  const form = new FormData();
  form.append('kind', kind);
  form.append('width', String(prepared.width));
  form.append('height', String(prepared.height));
  form.append('file', prepared.blob, file.name.replace(/\.[^.]+$/, '') + (prepared.blob.type === 'image/webp' ? '.webp' : '.jpg'));
  return apiUpload<UploadResult>('/uploads', form, { onProgress: opts?.onProgress });
}

/** Multipart `POST /uploads` (`kind: 'video'`) with the probed meta; the server re-probes and enforces ≤ 60 s. */
export async function uploadVideo(
  file: File,
  meta: { durationMs: number; width: number; height: number },
  onProgress?: (p: number) => void,
): Promise<UploadResult> {
  if (file.size > LIMITS.videoMaxBytes) {
    throw new ApiClientError(413, 'payload_too_large', 'That video is too large. Try one under 150 MB.');
  }
  const form = new FormData();
  form.append('kind', 'video');
  form.append('durationMs', String(Math.round(meta.durationMs)));
  form.append('width', String(meta.width));
  form.append('height', String(meta.height));
  form.append('file', file, file.name);
  return apiUpload<UploadResult>('/uploads', form, { onProgress });
}

export interface VideoMeta {
  durationMs: number;
  width: number;
  height: number;
  posterBlob: Blob;
}

/** Duration / dimensions + a first-frame poster (canvas). Rejects when the browser cannot decode the file. */
export function readVideoMeta(file: File): Promise<VideoMeta> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const fail = (msg: string) => done(() => reject(new Error(msg)));
    const timeout = window.setTimeout(() => fail("Couldn't read this video."), 20_000);

    video.onerror = () => {
      window.clearTimeout(timeout);
      fail("This video format isn't supported by your browser.");
    };
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        window.clearTimeout(timeout);
        fail("Couldn't read this video's length.");
        return;
      }
      // Seek slightly in so the first frame is not black on files with a leading fade.
      const target = Math.min(0.1, Math.max(0, video.duration / 10));
      const capture = () => {
        window.clearTimeout(timeout);
        const width = video.videoWidth || 0;
        const height = video.videoHeight || 0;
        const canvas = document.createElement('canvas');
        canvas.width = width || 540;
        canvas.height = height || 960;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          fail('Could not capture a poster.');
          return;
        }
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch {
          /* a decode error leaves a blank poster; still resolve */
        }
        canvas.toBlob(
          (blob) => {
            const durationMs = Math.round(video.duration * 1000);
            done(() =>
              blob
                ? resolve({ durationMs, width, height, posterBlob: blob })
                : reject(new Error('Could not capture a poster.')),
            );
          },
          'image/jpeg',
          0.85,
        );
      };
      video.onseeked = capture;
      try {
        video.currentTime = target;
      } catch {
        capture();
      }
    };
    video.src = url;
  });
}

export function toMediaImage(u: UploadResult, alt?: string): MediaImage {
  return { url: u.url, width: u.width, height: u.height, ...(alt !== undefined ? { alt } : {}) };
}

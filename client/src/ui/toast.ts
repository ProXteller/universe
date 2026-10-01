/**
 * Imperative toast API + its zustand store. `client/src/lib/toast.ts` (SPEC §4.4.1) re-exports this module:
 *   export { toast, type ToastOptions } from '@/ui/toast';
 * The store lives with `<Toaster/>` so the kit is self-contained and there is exactly one store.
 */
import { create } from 'zustand';

export type ToastTone = 'success' | 'error' | 'info' | 'neutral';

export interface ToastOptions {
  action?: { label: string; onClick(): void };
  /** Milliseconds. Default 4000, 7000 when there is an action. */
  duration?: number;
}

export interface ToastItem {
  id: number;
  tone: ToastTone;
  kind: 'message' | 'dev-inbox';
  message: string;
  action?: { label: string; onClick(): void };
  duration: number;
}

interface ToastState {
  toasts: ToastItem[];
  push(item: Omit<ToastItem, 'id'>): number;
  dismiss(id?: number): void;
}

/** At most two stacked; a third pushes the oldest out. */
const MAX_VISIBLE = 2;
let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (item) => {
    const id = nextId++;
    set((s) => {
      // Re-firing the same message replaces it instead of stacking a duplicate.
      const rest = s.toasts.filter((t) => !(t.kind === item.kind && t.message === item.message));
      return { toasts: [...rest, { ...item, id }].slice(-MAX_VISIBLE) };
    });
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: id === undefined ? [] : s.toasts.filter((t) => t.id !== id) })),
}));

function show(tone: ToastTone, message: string, opts?: ToastOptions): number {
  return useToastStore.getState().push({
    tone,
    kind: 'message',
    message,
    action: opts?.action,
    duration: opts?.duration ?? (opts?.action ? 7000 : 4000),
  });
}

export const toast = {
  success: (message: string, opts?: ToastOptions) => show('success', message, opts),
  error: (message: string, opts?: ToastOptions) => show('error', message, opts),
  info: (message: string, opts?: ToastOptions) => show('info', message, opts),
  show: (message: string, opts?: ToastOptions) => show('neutral', message, opts),
  /** Dev only: shows the 6-digit `devCode` with a "Fill" action. Never called in production (no devCode there). */
  devInbox: (code: string, onFill: () => void) =>
    useToastStore.getState().push({
      tone: 'info',
      kind: 'dev-inbox',
      message: code,
      action: { label: 'Fill', onClick: onFill },
      duration: 12000,
    }),
  dismiss: (id?: number) => useToastStore.getState().dismiss(id),
};

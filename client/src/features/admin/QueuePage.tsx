/**
 * Queue: the nine views as count chips, filters (surface · category · source), the card list, and multi-select bulk
 * actions (approve · remove · dismiss reports, ≤ 50; never for P0 / Wellbeing / Escalated / Appeals — the server refuses
 * per item). Copy: product §2.11.
 */
import { useMemo, useState, type FC } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Inbox, SlidersHorizontal, SquareCheck } from 'lucide-react';
import type { ModerationCategory, ModerationSurface } from '@shared/core';
import { CATEGORY_LABELS } from '@shared/core';
import type { BulkAction, QueueView } from '@shared/admin';
import { QUEUE_VIEWS, STAFF_ACTIONS } from '@shared/admin';
import { Button, ChipGroup, EmptyState, ErrorState, IconButton, InfiniteSentinel, Input, Select, SegmentedControl, Sheet, Textarea, type SelectOption } from '@/ui';
import { ComposerModeBanner } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { useMe } from '@/lib/session';
import { toast } from '@/lib/toast';
import { useBulk, useQueueCounts, useQueueList, type QueueFilters } from './api';
import { QueueCard, QueueCardSkeleton, SOURCE_LABEL, SURFACE_LABEL } from './parts';
import { AdminShell } from './shell';

const VIEW_IDS = new Set<string>(QUEUE_VIEWS.map((v) => v.id));
const CATEGORY_OPTIONS: readonly SelectOption<ModerationCategory | 'all'>[] = [
  { value: 'all', label: 'Any guideline' },
  ...(Object.keys(CATEGORY_LABELS) as ModerationCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
];
const SURFACE_OPTIONS: readonly SelectOption<ModerationSurface | 'all'>[] = [
  { value: 'all', label: 'Any surface' },
  ...(Object.keys(SURFACE_LABEL) as ModerationSurface[]).map((s) => ({ value: s, label: SURFACE_LABEL[s] })),
];
const SOURCE_OPTIONS: readonly SelectOption<string>[] = [{ value: 'all', label: 'Any source' }, ...Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value, label }))];
const BULK_OPTIONS = [
  { value: 'approve', label: 'Approve' },
  { value: 'dismiss_reports', label: 'Dismiss' },
  { value: 'remove', label: 'Remove' },
] as const satisfies readonly { value: BulkAction; label: string }[];

export const QueuePage: FC = () => {
  const me = useMe();
  const [params, setParams] = useSearchParams();
  const rawView = params.get('view') ?? 'priority';
  const view = (VIEW_IDS.has(rawView) ? rawView : 'priority') as QueueView;
  const [category, setCategory] = useState<ModerationCategory | 'all'>('all');
  const [surface, setSurface] = useState<ModerationSurface | 'all'>('all');
  const [source, setSource] = useState<string>('all');
  const [q, setQ] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction>('approve');
  const [bulkCategory, setBulkCategory] = useState<ModerationCategory | null>(null);
  const [bulkNote, setBulkNote] = useState('');

  useScreenView('admin_queue', { view });

  const filters: QueueFilters = useMemo(
    () => ({
      view,
      ...(category !== 'all' ? { category } : {}),
      ...(surface !== 'all' ? { surface } : {}),
      ...(source !== 'all' ? { source } : {}),
      ...(view === 'closed' && q.trim() ? { q: q.trim() } : {}),
    }),
    [view, category, surface, source, q],
  );
  const list = useQueueList(filters);
  const counts = useQueueCounts();
  const bulk = useBulk();
  const activeFilters = (category !== 'all' ? 1 : 0) + (surface !== 'all' ? 1 : 0) + (source !== 'all' ? 1 : 0);
  const views = QUEUE_VIEWS.filter((v) => !v.adminOnly || me.role === 'admin');

  const setView = (v: QueueView): void => {
    const next = new URLSearchParams(params);
    if (v === 'priority') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
    setSelected(new Set());
  };
  const toggle = (id: string): void => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else if (n.size < 50) n.add(id);
      else toast.info('Up to 50 items per bulk action.');
      return n;
    });
  };
  const bulkDef = STAFF_ACTIONS.find((a) => a.id === bulkAction);
  const bulkValid = bulkCategory !== null && (!bulkDef?.needsNote || bulkNote.trim().length >= 10);
  const runBulk = (): void => {
    if (!bulkCategory) return;
    bulk.mutate(
      { ids: [...selected], action: bulkAction, category: bulkCategory, note: bulkNote.trim() || undefined },
      {
        onSuccess: (res) => {
          const ok = res.results.filter((r) => r.ok).length;
          const failed = res.results.length - ok;
          toast.success(`${ok} ${ok === 1 ? 'item' : 'items'} actioned${failed ? `, ${failed} skipped` : ''}`);
          setBulkOpen(false);
          setSelecting(false);
          setSelected(new Set());
          setBulkNote('');
        },
      },
    );
  };

  let body;
  if (list.isLoading) {
    body = (
      <div className="flex flex-col gap-3 px-4">
        {Array.from({ length: 4 }, (_, i) => (
          <QueueCardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState title="Couldn't load the queue" error={list.error} onRetry={() => void list.refetch()} />;
  } else if (list.items.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        title="Queue clear. Nothing needs review right now."
        description={activeFilters ? 'Try clearing a filter.' : undefined}
        action={activeFilters ? { label: 'Clear filters', onClick: () => { setCategory('all'); setSurface('all'); setSource('all'); } } : undefined}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-3 px-4">
        {list.items.map((item) => (
          <QueueCard key={item.id} item={item} selecting={selecting} selected={selected.has(item.id)} onToggle={() => toggle(item.id)} />
        ))}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<QueueCardSkeleton />} endLabel={list.items.length > 5 ? 'End of this view' : null} />
      </div>
    );
  }

  const footer =
    selecting && selected.size > 0 ? (
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="type-label-sm text-ink">{selected.size} selected</span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => { setSelected(new Set()); setSelecting(false); }}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => setBulkOpen(true)}>
          Bulk action
        </Button>
      </div>
    ) : undefined;

  return (
    <AdminShell tab="queue" footer={footer}>
      <div className="flex items-center gap-2 px-4">
        <ChipGroup<QueueView>
          options={views.map((v) => ({ value: v.id, label: counts.data ? `${v.label} · ${counts.data[v.id]}` : v.label }))}
          value={view}
          onChange={(v: QueueView) => setView(v)}
          scroll="x"
          size="sm"
          aria-label="Queue view"
          className="min-w-0 flex-1"
        />
        <IconButton icon={SlidersHorizontal} aria-label={activeFilters ? `Filters, ${activeFilters} active` : 'Filters'} badge={activeFilters || undefined} size="sm" onClick={() => setFiltersOpen(true)} />
        <IconButton icon={SquareCheck} aria-label={selecting ? 'Exit select mode' : 'Select items'} active={selecting} size="sm" onClick={() => { setSelecting((s) => !s); setSelected(new Set()); }} />
      </div>
      {view === 'closed' ? (
        <div className="px-4">
          <Input variant="search" placeholder="Queue id" value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} aria-label="Search closed items by id" />
        </div>
      ) : null}
      {body}

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen} title="Filters" footer={<Button fullWidth onClick={() => setFiltersOpen(false)}>Done</Button>}>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Select<ModerationCategory | 'all'> label="Guideline" value={category} onChange={setCategory} options={CATEGORY_OPTIONS} />
          <Select<ModerationSurface | 'all'> label="Surface" value={surface} onChange={setSurface} options={SURFACE_OPTIONS} />
          <Select<string> label="Source" value={source} onChange={setSource} options={SOURCE_OPTIONS} />
        </div>
      </Sheet>

      <Sheet
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title={`Bulk action · ${selected.size} items`}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button variant={bulkAction === 'remove' ? 'danger' : 'primary'} fullWidth disabled={!bulkValid} loading={bulk.isPending} onClick={runBulk}>
              {bulkDef?.label ?? 'Apply'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-4 pb-4">
          <ComposerModeBanner mode="public" verb="Acting" size="inline" note="Every item gets its own audit row." />
          <SegmentedControl<BulkAction> value={bulkAction} onChange={setBulkAction} options={BULK_OPTIONS} fullWidth size="sm" aria-label="Bulk action" />
          <Select<ModerationCategory> label="Guideline" value={bulkCategory} onChange={setBulkCategory} options={CATEGORY_OPTIONS.filter((o) => o.value !== 'all') as SelectOption<ModerationCategory>[]} placeholder="Pick the guideline" />
          <Textarea label={bulkDef?.needsNote ? 'Note (required, staff only)' : 'Note (optional)'} value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} maxLength={500} minRows={2} />
          <p className="type-caption text-ink-3">P0, Wellbeing, Escalated and Appeals items are skipped; sanctions are always per item.</p>
        </div>
      </Sheet>
    </AdminShell>
  );
};

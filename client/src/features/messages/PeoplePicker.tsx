/**
 * People search + multi-select (foundation `GET /users/search`, never discover's API — SPEC §6): search field,
 * selected people as removable Chips, selectable `UserRow`s with a check trailing. Used by New chat and Add people.
 */
import { useMemo, useState, type FC } from 'react';
import { Check, Search, UserRoundSearch } from 'lucide-react';
import type { UserListItem, UserSummary } from '@shared/core';
import { Chip, EmptyState, ErrorState, InfiniteSentinel, Input, Skeleton } from '@/ui';
import { UserRow } from '@/components';
import { cn } from '@/lib/cn';
import { useDebounced } from '@/lib/hooks';
import { useInfiniteList } from '@/lib/query';
import { useMe } from '@/lib/session';
import { keys } from './api';

export interface PeoplePickerProps {
  selected: UserSummary[];
  onChange(next: UserSummary[]): void;
  /** Ids that cannot be picked (already members). */
  excludeIds?: readonly string[];
  max?: number;
  autoFocus?: boolean;
  /** Shown before typing. */
  placeholder?: string;
}

const RowSkeleton: FC = () => (
  <div className="flex min-h-16 items-center gap-3 px-4">
    <Skeleton w={40} h={40} circle />
    <div className="flex flex-1 flex-col gap-2">
      <Skeleton w="40%" h={13} />
      <Skeleton w="60%" h={11} />
    </div>
  </div>
);

export const PeoplePicker: FC<PeoplePickerProps> = ({ selected, onChange, excludeIds = [], max = 49, autoFocus = false, placeholder = 'Search people' }) => {
  const me = useMe();
  const [q, setQ] = useState('');
  const debounced = useDebounced(q.trim(), 250);
  const list = useInfiniteList<UserListItem>({ queryKey: [...keys.people(debounced)], path: '/users/search', query: { q: debounced }, enabled: debounced.length > 0 });
  const selectedIds = useMemo(() => new Set(selected.map((u) => u.id)), [selected]);
  const excluded = useMemo(() => new Set([...excludeIds, me.id]), [excludeIds, me.id]);

  const toggle = (u: UserSummary) => {
    if (selectedIds.has(u.id)) onChange(selected.filter((s) => s.id !== u.id));
    else if (selected.length < max) onChange([...selected, u]);
  };

  let body;
  if (!debounced) {
    body = <EmptyState icon={UserRoundSearch} title="Search by name or @handle" description="People from your campus come first." compact />;
  } else if (list.isLoading) {
    body = (
      <div className="flex flex-col">
        {Array.from({ length: 5 }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    );
  } else if (list.isError) {
    body = <ErrorState error={list.error} onRetry={() => void list.refetch()} inline />;
  } else if (list.items.length === 0) {
    body = <EmptyState icon={Search} title={`No one matches "${debounced}"`} compact />;
  } else {
    body = (
      <div className="flex flex-col">
        {list.items.map((u) => {
          const on = selectedIds.has(u.id);
          const off = excluded.has(u.id);
          return (
            <UserRow
              key={u.id}
              user={u}
              onClick={off ? () => undefined : () => toggle(u)}
              trailing={
                <span
                  aria-hidden
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full border transition-colors',
                    on ? 'border-accent bg-accent text-on-accent' : off ? 'border-line bg-surface-3 text-ink-4' : 'border-line-strong',
                  )}
                >
                  {on || off ? <Check size={14} strokeWidth={3} /> : null}
                </span>
              }
              reason={off ? 'Already in this chat' : undefined}
              className={cn(off && 'opacity-60')}
            />
          );
        })}
        <InfiniteSentinel {...list.sentinelProps} skeleton={<RowSkeleton />} endLabel={null} />
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 pb-1">
        <Input variant="search" leftIcon={Search} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} onClear={() => setQ('')} autoFocus={autoFocus} aria-label="Search people" />
      </div>
      {selected.length > 0 ? (
        <div className="scroll-x flex gap-2 px-4 py-2" role="list" aria-label="Selected people">
          {selected.map((u) => (
            <Chip key={u.id} variant="removable" size="sm" onRemove={() => toggle(u)} className="shrink-0">
              {u.displayName}
            </Chip>
          ))}
        </div>
      ) : null}
      {body}
    </div>
  );
};

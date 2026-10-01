/**
 * Browse · Saved · My profile — the three roots of the slice (product §2.7; §2.3 replaces design's Browse / My listing).
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs } from '@/ui';
import { routes } from '@/lib/links';

export type RoommatesTab = 'browse' | 'saved' | 'me';

const TABS: readonly { value: RoommatesTab; label: string }[] = [
  { value: 'browse', label: 'Browse' },
  { value: 'saved', label: 'Saved' },
  { value: 'me', label: 'My profile' },
];

const HREF: Record<RoommatesTab, () => string> = {
  browse: () => routes.roommates(),
  saved: () => routes.roommatesSaved(),
  me: () => routes.roommatesMe(),
};

export const RoommatesTabs: FC<{ value: RoommatesTab }> = ({ value }) => {
  const navigate = useNavigate();
  return (
    <Tabs
      value={value}
      onChange={(v) => {
        if (v !== value) navigate(HREF[v](), { replace: true });
      }}
      tabs={TABS}
      aria-label="Roommates sections"
    />
  );
};

/**
 * `/market/saved`: the grid of listings the viewer hearted (price-drop notifications come from here).
 */
import type { FC } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { EmptyState, PageHeader, Screen } from '@/ui';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import { useSaved } from './api';
import { MARKET_COPY } from './labels';
import { ListingGrid } from './ListingGrid';

export const SavedPage: FC = () => {
  const navigate = useNavigate();
  const list = useSaved();
  useScreenView('market_saved');
  return (
    <Screen header={<PageHeader title="Saved" mode="compact" back />}>
      <ListingGrid
        items={list.items}
        isLoading={list.isLoading}
        isError={list.isError}
        error={list.error}
        onRetry={() => void list.refetch()}
        sentinelProps={list.sentinelProps}
        errorTitle="Couldn't load your saved listings"
        empty={<EmptyState icon={Heart} title="Nothing saved yet" description={MARKET_COPY.savedEmpty} action={{ label: 'Browse', onClick: () => navigate(routes.market()) }} />}
      />
    </Screen>
  );
};

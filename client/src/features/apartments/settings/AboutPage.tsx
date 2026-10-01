/**
 * Settings → About: Community Guidelines, Terms, Privacy, version (`font-mono type-caption`).
 */
import type { FC } from 'react';
import { BookOpen, FileText, Lock, Tag } from 'lucide-react';
import { APP_NAME } from '@shared/core';
import { ListRow } from '@/ui';
import { Wordmark } from '@/components';
import { useScreenView } from '@/lib/analytics';
import { routes } from '@/lib/links';
import pkg from '../../../../package.json';
import { Group, RowIcon, SettingsScreen } from './shared';

const VERSION: string = typeof pkg.version === 'string' ? pkg.version : '0.0.0';

export const AboutPage: FC = () => {
  useScreenView('settings_about');
  return (
    <SettingsScreen title="About">
      <div className="flex flex-col items-center gap-2 py-4">
        <Wordmark size="lg" />
        <p className="type-footnote text-ink-3">The campus super-app for verified students.</p>
      </div>
      <Group label="Read">
        <ListRow leading={<RowIcon icon={BookOpen} tone="accent" />} title="Community Guidelines" to={routes.guidelines()} trailing="chevron" />
        <ListRow leading={<RowIcon icon={FileText} />} title="Terms of Service" to={routes.legal('terms')} trailing="chevron" />
        <ListRow leading={<RowIcon icon={Lock} />} title="Privacy Policy" to={routes.legal('privacy')} trailing="chevron" />
      </Group>
      <Group label="App">
        <ListRow leading={<RowIcon icon={Tag} />} title="Version" trailing={<span className="font-mono type-caption text-ink-3">{`${APP_NAME.toLowerCase()} ${VERSION}`}</span>} />
      </Group>
    </SettingsScreen>
  );
};

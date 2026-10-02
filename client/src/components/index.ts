/**
 * Shared composites (SPEC §4.4.2). Slices import from '@/components'; the hosts at the bottom are mounted once
 * by AppShell and driven through `lib/report.ts`, `lib/share.ts`, `lib/moderation.ts`.
 */
export { Wordmark } from './Wordmark';
export type { WordmarkProps } from './Wordmark';

export { UserAvatar } from './UserAvatar';
export type { UserAvatarProps, UserAvatarUser } from './UserAvatar';
export { UserRow } from './UserRow';
export type { UserRowProps } from './UserRow';
export { FollowButton } from './FollowButton';
export type { FollowButtonProps } from './FollowButton';

export { MediaBox } from './MediaBox';
export type { MediaBoxProps, MediaAspect } from './MediaBox';
export { MediaPicker } from './MediaPicker';
export type { MediaPickerProps } from './MediaPicker';
export { ShareCardView } from './ShareCardView';
export type { ShareCardViewProps } from './ShareCardView';

export { OverflowMenu } from './OverflowMenu';
export type { OverflowMenuProps } from './OverflowMenu';
export { ComposerModeBanner, ComposerGuard } from './Composer';
export type { ComposerModeBannerProps, ComposerGuardProps } from './Composer';

export { CountLabel, TimeAgo, SectionHeader } from './text';
export type { CountLabelProps, TimeAgoProps, SectionHeaderProps } from './text';
export { CampusScopeToggle, ColdStartBanner, SafetyCard } from './feed';
export type { CampusScopeToggleProps, ColdStartBannerProps, SafetyCardProps } from './feed';

export { UserListSheet } from './UserListSheet';
export type { UserListSheetProps } from './UserListSheet';

export { PageLoader, RouteError, NotFound } from './fallbacks';
export type { PageLoaderProps, RouteErrorProps, NotFoundProps } from './fallbacks';

// Sheets + hosts (hosts are mounted once by AppShell)
export { ReportSheet, ReportHost } from './ReportSheet';
export type { ReportSheetProps } from './ReportSheet';
export { BlockDialog, BlockHost, blockUser } from './BlockDialog';
export type { BlockDialogProps } from './BlockDialog';
export { ShareSheet, ShareHost } from './ShareSheet';
export type { ShareSheetProps } from './ShareSheet';
export { ModerationHost } from './ModerationHost';
export { SanctionGate } from './SanctionGate';
export { PasswordInput } from './PasswordInput';
export type { PasswordInputProps } from './PasswordInput';

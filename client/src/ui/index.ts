/**
 * UniVerse UI kit — SPEC §2.2. Named exports only; every component accepts `className` and forwards `ref`.
 * Slices import from '@/ui' and never fork a component (report the gap instead).
 */

// Surface modes (the anonymity firewall, visually)
export { Surface, SurfaceContext, useSurfaceMode } from './Surface';
export type { SurfaceMode, SurfaceProps } from './Surface';

// Actions
export { Button } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from './IconButton';
export { FAB } from './FAB';
export type { FABProps } from './FAB';

// Form controls
export { Input } from './Input';
export type { InputProps } from './Input';
export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
export { Select, MultiSelect } from './Select';
export type { SelectProps, MultiSelectProps, SelectOption } from './Select';
export { Switch } from './Switch';
export type { SwitchProps } from './Switch';
export { Slider, RangeSlider } from './Slider';
export type { SliderProps, RangeSliderProps } from './Slider';
export { OTPInput } from './OTPInput';
export type { OTPInputProps } from './OTPInput';

// Selection & navigation
export { Chip, ChipGroup } from './Chip';
export type { ChipProps, ChipGroupProps, ChipGroupOption } from './Chip';
export { Badge, VerifiedBadge, OpBadge, CampusBadge } from './Badge';
export type { BadgeProps, BadgeTone } from './Badge';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps } from './SegmentedControl';
export { Tabs } from './Tabs';
export type { TabsProps } from './Tabs';
export { ProgressBar, StepDots, ProgressRing, NumberStepper } from './Progress';
export type { ProgressBarProps, StepDotsProps, ProgressRingProps, NumberStepperProps } from './Progress';

// Identity
export { Avatar, AvatarStack } from './Avatar';
export type { AvatarProps, AvatarSize, AvatarStackProps } from './Avatar';
export { AliasAvatar } from './AliasAvatar';
export type { AliasAvatarProps } from './AliasAvatar';

// Containers
export { Card } from './Card';
export type { CardProps } from './Card';
export { ListRow } from './ListRow';
export type { ListRowProps } from './ListRow';
export { PageHeader } from './PageHeader';
export type { PageHeaderProps } from './PageHeader';
export { Screen, ScreenContext, useScreen } from './Screen';
export type { ScreenProps, ScreenContextValue } from './Screen';
export { Sheet } from './Sheet';
export type { SheetProps, SheetDetent } from './Sheet';
export { ActionSheet } from './ActionSheet';
export type { ActionSheetProps, ActionSheetAction } from './ActionSheet';
export { Dialog } from './Dialog';
export type { DialogProps } from './Dialog';
export { Lightbox } from './Lightbox';
export type { LightboxProps } from './Lightbox';

// Feedback & async
export { Toaster } from './Toaster';
export type { ToasterProps } from './Toaster';
export { toast } from './toast';
export type { ToastOptions } from './toast';
export { Skeleton, SkeletonText } from './Skeleton';
export type { SkeletonProps, SkeletonTextProps } from './Skeleton';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';
export { InfiniteSentinel } from './InfiniteSentinel';
export type { InfiniteSentinelProps } from './InfiniteSentinel';
export { PullToRefresh } from './PullToRefresh';
export type { PullToRefreshProps } from './PullToRefresh';

// Shell plumbing the foundation app layer needs (not for slices)
export { OverlayPortal, getOverlayRoot } from './overlay';
export type { OverlayPortalProps } from './overlay';
export { useNavVisibility, setNavVisibility, getNavVisibility } from './navVisibility';

/**
 * Notification renderer table — every type of SPEC §4.4.4 (this slice renders all of them). Money placeholders are
 * numbers in `data` and go through `formatPrice` (viewer's campus currency). Anonymous (Buzz) rows never name anyone.
 */
import type { LucideIcon } from 'lucide-react';
import {
  ArrowBigUp, BarChart2, Bell, CalendarCheck, CalendarClock, CalendarX, Clock, Eye, EyeOff, Flag, Heart, Home, Mail, MailCheck, Megaphone,
  MessageCircle, MicOff, Reply, Scale, ShieldAlert, ShieldCheck, Tag, TrendingDown, Trophy, Trash2, UserPlus, Users, VenetianMask, VolumeX,
} from 'lucide-react';
import type { Notification, NotificationData, PublicNotification } from '@shared/core';
import { CATEGORY_LABELS, type ModerationCategory } from '@shared/core';
import { formatDate, formatPrice } from '@/lib/format';

export interface NotificationView {
  icon: LucideIcon;
  /** Primary line (the actor's name is already folded in). */
  title: string;
  /** Optional second line (snippet, announcement body, guideline hint). */
  subtitle?: string;
  /** Row action label shown next to the copy (only "See guidelines" / "Follow back" exist as controls). */
  hint?: string;
}

const str = (d: NotificationData, key: string, fallback = ''): string => {
  const v = d[key];
  return v === null || v === undefined ? fallback : String(v);
};
const num = (d: NotificationData, key: string): number | null => {
  const v = d[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const money = (d: NotificationData, key: string): string => {
  const n = num(d, key);
  return n === null ? '' : formatPrice(n);
};
const quote = (s: string): string => (s ? `“${s}”` : '');
const category = (d: NotificationData): string => {
  const c = str(d, 'category');
  return c && c in CATEGORY_LABELS ? CATEGORY_LABELS[c as ModerationCategory] : 'our guidelines';
};
const until = (d: NotificationData): string => {
  const n = num(d, 'until');
  return n === null ? '' : ` until ${formatDate(n)}`;
};

/** "{name}" or "{name} and 12 others". */
function actorLabel(n: PublicNotification): string {
  const name = n.actor?.displayName ?? 'Someone';
  if (n.actorCount > 1) return `${name} and ${n.actorCount - 1} ${n.actorCount - 1 === 1 ? 'other' : 'others'}`;
  return name;
}

export function notificationView(n: Notification): NotificationView {
  const d = n.data;
  if (n.anonymous) {
    switch (n.type) {
      case 'buzz.reply': {
        const snippet = str(d, 'snippet');
        return { icon: VenetianMask, title: 'Someone replied to your buzz', subtitle: snippet ? quote(snippet) : undefined };
      }
      case 'buzz.milestone':
        return { icon: ArrowBigUp, title: `Your buzz passed ${str(d, 'upvotes', '0')} upvotes` };
      case 'buzz.poll_closed':
        return { icon: BarChart2, title: `Your poll closed · ${str(d, 'votes', '0')} votes` };
      default:
        return { icon: VenetianMask, title: 'Activity on your buzz' };
    }
  }
  const who = actorLabel(n);
  switch (n.type) {
    case 'follow.new':
      return { icon: UserPlus, title: `${who} started following you` };
    case 'system.announcement':
      return { icon: Megaphone, title: str(d, 'title', 'Announcement'), subtitle: str(d, 'body') || undefined };
    case 'reel.like':
      return { icon: Heart, title: `${who} liked your reel`, subtitle: str(d, 'caption') || undefined };
    case 'reel.comment':
      return { icon: MessageCircle, title: `${who} commented: ${quote(str(d, 'snippet'))}` };
    case 'reel.comment_reply':
      return { icon: Reply, title: `${who} replied: ${quote(str(d, 'snippet'))}` };
    case 'post.like':
      return { icon: Heart, title: `${who} liked your post`, subtitle: str(d, 'snippet') || undefined };
    case 'post.comment':
      return { icon: MessageCircle, title: `${who} commented: ${quote(str(d, 'snippet'))}` };
    case 'post.comment_reply':
      return { icon: Reply, title: `${who} replied: ${quote(str(d, 'snippet'))}` };
    case 'message.request':
      return { icon: Mail, title: `${who} sent you a message request`, subtitle: d.hasContext ? 'About your listing or roommate post' : undefined };
    case 'message.request_accepted':
      return { icon: MailCheck, title: `${who} accepted your message request` };
    case 'message.group_added':
      return { icon: Users, title: `${who} added you to ${str(d, 'title', 'a group')}` };
    case 'market.offer':
      return { icon: Tag, title: `${who} offered ${money(d, 'amount')} for ${str(d, 'title')}` };
    case 'market.offer_accepted':
      return { icon: Tag, title: `${who} accepted your ${money(d, 'amount')} offer`, subtitle: str(d, 'title') || undefined };
    case 'market.offer_declined':
      return { icon: Tag, title: `${who} declined your ${money(d, 'amount')} offer`, subtitle: str(d, 'title') || undefined };
    case 'market.price_drop':
      return { icon: TrendingDown, title: `Price drop: ${str(d, 'title')} is now ${money(d, 'newPrice')} (was ${money(d, 'oldPrice')})` };
    case 'roommate.still_looking':
      return { icon: Home, title: 'Still looking for a roommate?', subtitle: 'Confirm to keep your post visible.' };
    case 'event.rsvp':
      return { icon: CalendarCheck, title: `${who} is ${str(d, 'state') === 'interested' ? 'interested in' : 'going to'} ${str(d, 'title')}` };
    case 'event.reminder':
      return { icon: Clock, title: `Starts in 1 hour: ${str(d, 'title')}` };
    case 'event.cancelled':
      return { icon: CalendarX, title: `Cancelled: ${str(d, 'title')}` };
    case 'event.updated':
      return { icon: CalendarClock, title: `Updated: ${str(d, 'title')}` };
    case 'campus.milestone':
      return { icon: Trophy, title: `${str(d, 'universityName', 'Your campus')} just passed ${str(d, 'goal')} students.` };
    case 'mod.report_resolved':
      return str(d, 'outcome') === 'actioned'
        ? { icon: ShieldCheck, title: 'Thanks — we reviewed your report and took action.' }
        : { icon: ShieldCheck, title: "Thanks — we reviewed your report and didn't find a violation.", subtitle: 'Reports still help us spot patterns.' };
    case 'mod.content_hidden':
      return { icon: EyeOff, title: `Your ${str(d, 'label', 'post')} is hidden while we review it.`, subtitle: str(d, 'excerpt') ? quote(str(d, 'excerpt')) : undefined };
    case 'mod.content_restored':
      return { icon: Eye, title: `Your ${str(d, 'label', 'post')} is back up.` };
    case 'mod.content_removed':
      return {
        icon: Trash2,
        title: `Your ${str(d, 'label', 'post')} was removed for breaking the guidelines: ${category(d)}.`,
        subtitle: str(d, 'excerpt') ? quote(str(d, 'excerpt')) : undefined,
        hint: 'See guidelines',
      };
    case 'mod.warning':
      return { icon: ShieldAlert, title: `You received a warning about ${category(d)}.`, subtitle: 'No restrictions this time.', hint: 'See guidelines' };
    case 'mod.muted':
      return { icon: MicOff, title: `You're muted${until(d)}.`, subtitle: 'You can read and vote, but not post.' };
    case 'mod.suspended':
      return num(d, 'until') === null
        ? { icon: VolumeX, title: 'Your account has been permanently banned.', subtitle: 'You can appeal once within 14 days.' }
        : { icon: VolumeX, title: `Your account is suspended${until(d)}.`, subtitle: 'You can appeal once.' };
    case 'mod.appeal_received':
      return { icon: Scale, title: 'We received your appeal.', subtitle: "A different reviewer will look at it. We'll let you know." };
    case 'mod.appeal_result': {
      const outcome = str(d, 'outcome');
      const title =
        outcome === 'reversed' ? 'Your appeal was accepted.' : outcome === 'reduced' ? 'Your appeal was reviewed: the sanction was reduced.' : 'Your appeal was reviewed: the decision stands.';
      return { icon: Scale, title };
    }
    case 'admin.unmask_alert':
      return { icon: Flag, title: `An admin unmasked a Buzz author · ${str(d, 'reasonCode', 'no reason code')}` };
    default:
      return { icon: Bell, title: 'New activity' };
  }
}

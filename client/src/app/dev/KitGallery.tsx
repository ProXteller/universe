/**
 * Dev-only UI-kit gallery (route `/dev/kit`). Every kit component and state, in BOTH surface modes: the
 * toggle under the title swaps `<Surface mode>` for the whole page, overlays included. It also models the
 * firewall rule: `Avatar` appears only in Aurora, `AliasAvatar` / `OpBadge` / the mask glyph only in incognito.
 */
import { useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bookmark,
  CalendarDays,
  Flag,
  Flame,
  Heart,
  Link2,
  Lock,
  MapPin,
  Moon,
  PenLine,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tag,
  Trash2,
  VenetianMask,
} from 'lucide-react';
import type { MediaImage } from '@shared/core';
import { currencySymbol, formatPrice } from '@/lib/format';
import { setReducedMotionSetting, useReducedMotionPref } from '@/lib/motion';
import {
  ActionSheet,
  AliasAvatar,
  Avatar,
  AvatarStack,
  Badge,
  Button,
  CampusBadge,
  Card,
  Chip,
  ChipGroup,
  Dialog,
  EmptyState,
  ErrorState,
  FAB,
  IconButton,
  InfiniteSentinel,
  Input,
  Lightbox,
  ListRow,
  MultiSelect,
  NumberStepper,
  OTPInput,
  OpBadge,
  PageHeader,
  ProgressBar,
  ProgressRing,
  PullToRefresh,
  RangeSlider,
  Screen,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  SkeletonText,
  Slider,
  StepDots,
  Surface,
  Switch,
  Tabs,
  Textarea,
  Toaster,
  VerifiedBadge,
  toast,
  type SurfaceMode,
} from '@/ui';

/** The gallery's own route (router.tsx registers it in dev only); demo links point back here. */
const KIT_PATH = '/dev/kit';
/** Demo prices are formatted like the app does (SPEC §4.4.1 `formatPrice` / `currencySymbol`), pinned to USD. */
const DEMO_CURRENCY = 'USD';

/* ------------------------------------------------------------------ local art (no network, ever) */

function svgUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function face(bg: string, fg: string): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="${bg}"/><circle cx="40" cy="32" r="14" fill="${fg}"/><path d="M12 80c2-20 14-30 28-30s26 10 28 30z" fill="${fg}"/></svg>`,
  );
}

function nebula(a: string, b: string, w: number, h: number): string {
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><radialGradient id="a" cx=".25" cy=".2" r=".9"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="#090b14"/></radialGradient><radialGradient id="b" cx=".85" cy=".9" r=".7"><stop offset="0" stop-color="${b}" stop-opacity=".9"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#a)"/><rect width="${w}" height="${h}" fill="url(#b)"/><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * 0.42}" ry="${h * 0.16}" fill="none" stroke="#fff" stroke-opacity=".14" transform="rotate(-24 ${w / 2} ${h / 2})"/></svg>`,
  );
}

const FACES = {
  maya: face('#2a1f47', '#bcacff'),
  ethan: face('#0f3340', '#5eead4'),
  chloe: face('#40202c', '#f0abfc'),
  club: face('#1f2547', '#93a5ff'),
};

const GALLERY: MediaImage[] = [
  { url: nebula('#8b5cff', '#22d3ee', 800, 1000), width: 800, height: 1000, alt: 'Violet nebula over the quad' },
  { url: nebula('#5b7cff', '#5eead4', 1000, 1000), width: 1000, height: 1000, alt: 'Azure nebula, square crop' },
  { url: nebula('#c04dff', '#5b7cff', 1600, 900), width: 1600, height: 900 },
];

/* ------------------------------------------------------------------ layout helpers */

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-4">
      <div>
        <h2 className="type-title-3 text-ink">{title}</h2>
        {note ? <p className="mt-0.5 type-footnote text-ink-3">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <div className="type-overline text-ink-3">{children}</div>;
}

function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>{children}</div>;
}

function IconDisc({ icon: Icon }: { icon: typeof Bell }) {
  return (
    <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-ink-2">
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/* ------------------------------------------------------------------ sections */

function Foundations() {
  const swatches = ['bg-canvas', 'bg-surface-1', 'bg-surface-2', 'bg-surface-3', 'bg-surface-4', 'bg-accent', 'bg-accent-soft', 'bg-hero'];
  return (
    <Section title="Foundations" note="Semantic slots only. The same classes repaint when the surface mode changes.">
      <div className="grid grid-cols-4 gap-2">
        {swatches.map((s) => (
          <div key={s} className="flex flex-col gap-1">
            <div className={`h-12 rounded-sm border border-line ${s}`} />
            <span className="truncate type-micro text-ink-3">{s.replace('bg-', '')}</span>
          </div>
        ))}
      </div>
      <Card>
        <div className="flex flex-col gap-2">
          <p className="type-display text-hero">Your campus orbit</p>
          <p className="type-title-1">Title 1 · Marketplace</p>
          <p className="type-title-2">Title 2 · {formatPrice(60, DEMO_CURRENCY)}</p>
          <p className="type-title-3">Title 3 · Section header</p>
          <p className="type-headline">Headline · Maya Okafor</p>
          <p className="type-body-lg text-ink-2">Body large · thread roots and post detail.</p>
          <p className="type-body text-ink-2">Body · feed text, chat bubbles, descriptions.</p>
          <p className="type-footnote text-ink-3">Footnote · helper text and secondary lines</p>
          <p className="type-caption text-ink-3">Caption · 3m · 1.2K</p>
          <p className="type-overline text-ink-3">Overline · group label</p>
        </div>
      </Card>
    </Section>
  );
}

function Buttons({ incognito }: { incognito: boolean }) {
  const [loading, setLoading] = useState(false);
  const run = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1600);
  };
  return (
    <Section title="Button" note="Seven variants, three sizes, loading keeps its width.">
      <Row>
        <Button>Primary</Button>
        <Button variant="hero" rightIcon={ArrowRight}>
          Hero
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="danger" leftIcon={Trash2}>
          Delete
        </Button>
        <Button variant="danger-ghost">Remove</Button>
      </Row>
      <Label>Sizes</Label>
      <Row>
        <Button size="sm" leftIcon={Plus}>
          Small 36
        </Button>
        <Button size="md" leftIcon={Plus}>
          Medium 44
        </Button>
        <Button size="lg" leftIcon={Plus}>
          Large 52
        </Button>
      </Row>
      <Label>States</Label>
      <Row>
        <Button loading={loading} onClick={run}>
          Tap to load
        </Button>
        <Button variant="secondary" loading>
          Saving
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
        <Button variant="outline" to={KIT_PATH} rightIcon={Link2}>
          Router link
        </Button>
      </Row>
      <Button variant="hero" size="lg" fullWidth leftIcon={incognito ? VenetianMask : Sparkles}>
        {incognito ? 'Post anonymously' : 'Get notified'}
      </Button>
    </Section>
  );
}

function IconButtons() {
  const [liked, setLiked] = useState(true);
  const [saved, setSaved] = useState(false);
  return (
    <Section title="IconButton" note="Always labelled. Badge, toggled fill, 44px hit area at every size.">
      <Row>
        <IconButton icon={Bell} aria-label="Notifications" badge={7} />
        <IconButton icon={Send} aria-label="Messages" badge="dot" />
        <IconButton icon={Settings} aria-label="Settings" variant="filled" />
        <IconButton icon={Plus} aria-label="Create" variant="accent" />
        <IconButton icon={Flag} aria-label="Report" disabled />
        <IconButton icon={Heart} aria-label="Like" active={liked} activeTone="love" onClick={() => setLiked((v) => !v)} />
        <IconButton icon={Bookmark} aria-label="Save" active={saved} onClick={() => setSaved((v) => !v)} />
      </Row>
      <Row>
        <IconButton icon={Search} aria-label="Search" size="sm" variant="filled" />
        <IconButton icon={Search} aria-label="Search" size="md" variant="filled" />
        <IconButton icon={Search} aria-label="Search" size="lg" variant="filled" />
        <div className="flex items-center gap-2 rounded-lg bg-hero p-2">
          <IconButton icon={Heart} aria-label="Like" variant="glass" active activeTone="love" />
          <IconButton icon={Send} aria-label="Share" variant="glass" badge={128} />
        </div>
      </Row>
    </Section>
  );
}

function Fields({ incognito }: { incognito: boolean }) {
  const [email, setEmail] = useState('maya');
  const [query, setQuery] = useState('mini fridge');
  const [bio, setBio] = useState('Junior, CS + design minor. Looking for a quiet two-bed near West Campus.');
  const [post, setPost] = useState('');
  const [year, setYear] = useState<'fr' | 'so' | 'jr' | 'sr' | null>(null);
  const [tags, setTags] = useState<string[]>(['clean', 'early']);
  const [dark, setDark] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const [distance, setDistance] = useState(3);
  const [budget, setBudget] = useState<[number, number]>([650, 1100]);
  const [beds, setBeds] = useState(2);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'error' | 'success'>('idle');

  const verify = (value: string) => {
    setStatus('verifying');
    window.setTimeout(() => {
      const ok = value === '123456';
      setStatus(ok ? 'success' : 'error');
      if (!ok) window.setTimeout(() => setStatus('idle'), 700);
    }, 900);
  };

  return (
    <Section title="Form controls" note="16px input text everywhere; focus = accent border + soft ring.">
      <Input label="University email" placeholder="you@utexas.edu" helper="We only accept university addresses." rightSlot={<span className="type-footnote text-ink-3">@utexas.edu</span>} value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Price" prefix={currencySymbol(DEMO_CURRENCY)} inputMode="numeric" placeholder="0" error="Enter a price, or mark it as free." />
      <Input label="Meet-up spot" leftIcon={MapPin} placeholder="PCL lobby" size="lg" />
      <Input label="Disabled" placeholder="Not editable" disabled />
      <Input variant="search" aria-label="Search listings" placeholder="Search listings" value={query} onChange={(e) => setQuery(e.target.value)} onClear={() => setQuery('')} />
      <Textarea label="About you" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={160} helper="Shown on your roommate profile." />
      <Card variant="raised">
        <Label>Bare composer</Label>
        <Textarea
          variant="bare"
          aria-label="Compose"
          minRows={2}
          maxRows={6}
          maxLength={280}
          value={post}
          onChange={(e) => setPost(e.target.value)}
          placeholder={incognito ? 'Say it anonymously…' : "What's happening on campus?"}
          className="mt-2"
        />
      </Card>
      <Select
        label="Class year"
        placeholder="Choose your year"
        value={year}
        onChange={setYear}
        options={[
          { value: 'fr', label: 'Freshman', description: 'First year on campus' },
          { value: 'so', label: 'Sophomore' },
          { value: 'jr', label: 'Junior' },
          { value: 'sr', label: 'Senior', icon: Sparkles },
        ]}
      />
      <MultiSelect
        label="Lifestyle"
        placeholder="Pick up to 3"
        max={3}
        value={tags}
        onChange={setTags}
        options={[
          { value: 'clean', label: 'Tidy' },
          { value: 'early', label: 'Early riser' },
          { value: 'night', label: 'Night owl' },
          { value: 'pets', label: 'Pet friendly' },
          { value: 'quiet', label: 'Quiet hours' },
        ]}
      />
      <Select label="With an error" value={null} onChange={() => undefined} options={[{ value: 'a', label: 'Option A' }]} error="Choose one to continue." />

      <Card className="p-0">
        <ListRow leading={<IconDisc icon={Moon} />} title="Reduce motion" subtitle="Fades instead of slides" trailing={<MotionSwitch />} />
        <ListRow leading={<IconDisc icon={Bell} />} title="Push notifications" trailing={<Switch checked={dark} onChange={setDark} aria-label="Push notifications" />} />
        <ListRow leading={<IconDisc icon={Lock} />} title="Quiet hours" subtitle="Locked by your campus" trailing={<Switch checked={quiet} onChange={setQuiet} disabled aria-label="Quiet hours" />} />
      </Card>

      <Slider label="Max distance from campus" min={0} max={10} step={0.5} value={distance} onChange={setDistance} format={(v) => `${v} mi`} />
      <RangeSlider label="Monthly budget" min={300} max={2000} step={50} minGap={100} value={budget} onChange={setBudget} format={(v) => `$${v}`} />

      <div className="flex items-center justify-between">
        <span className="type-body text-ink-2">Bedrooms</span>
        <NumberStepper value={beds} min={1} max={6} onChange={setBeds} aria-label="Bedrooms" />
      </div>

      <Card variant="raised" className="flex flex-col gap-3">
        <Label>OTP · type 123456 to pass, anything else to fail</Label>
        <OTPInput
          value={code}
          onChange={(v) => {
            setCode(v);
            if (status !== 'verifying') setStatus('idle');
          }}
          onComplete={verify}
          status={status}
        />
        <Row>
          <Button size="sm" variant="secondary" onClick={() => { setCode(''); setStatus('idle'); }}>
            Reset
          </Button>
          <Button size="sm" variant="ghost" onClick={() => toast.devInbox('123456', () => { setCode('123456'); verify('123456'); })}>
            Dev inbox toast
          </Button>
        </Row>
      </Card>
    </Section>
  );
}

function MotionSwitch() {
  const reduced = useReducedMotionPref();
  return <Switch checked={reduced} onChange={setReducedMotionSetting} aria-label="Reduce motion" />;
}

function Selection({ incognito }: { incognito: boolean }) {
  const [filters, setFilters] = useState({ free: true, near: false });
  const [removable, setRemovable] = useState(['Textbooks', 'Under $50', 'West Campus']);
  const [category, setCategory] = useState<string | null>('all');
  const [interests, setInterests] = useState<string[]>(['music']);
  const [sort, setSort] = useState<'hot' | 'new' | 'top'>('hot');
  const [scope, setScope] = useState<'campus' | 'global'>('campus');
  const [tab, setTab] = useState<'reels' | 'posts' | 'about'>('reels');
  const [admin, setAdmin] = useState('queue');

  return (
    <Section title="Selection & navigation" note="Segmented = filter, Tabs = different content.">
      <Label>Chip</Label>
      <Row>
        <Chip selected={filters.free} onClick={() => setFilters((f) => ({ ...f, free: !f.free }))} leftIcon={Tag}>
          Free
        </Chip>
        <Chip selected={filters.near} onClick={() => setFilters((f) => ({ ...f, near: !f.near }))} count={12}>
          Near me
        </Chip>
        <Chip size="sm" selected>
          Small on
        </Chip>
        <Chip size="sm">Small off</Chip>
        <Chip disabled>Disabled</Chip>
        <Chip variant="tag">CS 314</Chip>
        <Chip variant="tag" size="sm" leftIcon={BookOpen}>
          Textbook
        </Chip>
      </Row>
      <Row>
        {removable.map((r) => (
          <Chip key={r} variant="removable" onRemove={() => setRemovable((list) => list.filter((x) => x !== r))}>
            {r}
          </Chip>
        ))}
        {removable.length === 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setRemovable(['Textbooks', 'Under $50', 'West Campus'])}>
            Restore filters
          </Button>
        ) : null}
      </Row>
      <Label>ChipGroup · single, scrolls (never drags the pager)</Label>
      <ChipGroup
        aria-label="Category"
        scroll="x"
        className="-mx-4 px-4"
        value={category}
        onChange={setCategory}
        options={[
          { value: 'all', label: 'All' },
          { value: 'books', label: 'Textbooks', icon: BookOpen },
          { value: 'furniture', label: 'Furniture' },
          { value: 'tech', label: 'Electronics' },
          { value: 'tickets', label: 'Tickets' },
          { value: 'clothes', label: 'Clothing' },
          { value: 'free', label: 'Free stuff' },
        ]}
      />
      <Label>ChipGroup · multiple, max 3</Label>
      <ChipGroup
        aria-label="Interests"
        multiple
        max={3}
        size="sm"
        value={interests}
        onChange={setInterests}
        options={['music', 'climbing', 'film', 'startups', 'intramurals', 'cooking'].map((v) => ({ value: v, label: v[0]!.toUpperCase() + v.slice(1) }))}
      />

      <Label>SegmentedControl</Label>
      <SegmentedControl
        aria-label="Sort"
        fullWidth
        value={sort}
        onChange={setSort}
        options={[
          { value: 'hot', label: 'Hot', icon: Flame },
          { value: 'new', label: 'New' },
          { value: 'top', label: 'Top' },
        ]}
      />
      <SegmentedControl
        aria-label="Scope"
        size="sm"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'campus', label: 'Campus' },
          { value: 'global', label: 'Global' },
        ]}
      />

      <Label>Tabs</Label>
      <div className="-mx-4">
        <Tabs
          aria-label="Profile sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'reels', label: 'Reels', count: 12 },
            { value: 'posts', label: 'Posts', count: 48 },
            { value: 'about', label: 'About' },
          ]}
        />
        <Tabs
          aria-label="Trust and safety"
          scrollable
          value={admin}
          onChange={setAdmin}
          tabs={['Queue', 'Users', 'Appeals', 'Audit', 'Analytics', 'Rules'].map((l) => ({ value: l.toLowerCase(), label: l, count: l === 'Queue' ? 9 : undefined }))}
        />
      </div>

      <Label>Badge</Label>
      <Row>
        <Badge>Neutral</Badge>
        <Badge tone="accent">Accent</Badge>
        <Badge tone="success">Available</Badge>
        <Badge tone="warning">In review</Badge>
        <Badge tone="danger">Removed</Badge>
        <Badge tone="info">New</Badge>
        <Badge tone="gold">Free</Badge>
      </Row>
      <Row>
        <Badge variant="outline" tone="accent">
          Outline
        </Badge>
        <Badge variant="outline" tone="success">
          Going
        </Badge>
        <Badge variant="count" count={3} />
        <Badge variant="count" count={128} />
        <Badge variant="dot" />
        <Badge variant="dot" tone="success" />
        <CampusBadge name="UT Austin" />
        {incognito ? <OpBadge /> : <VerifiedBadge />}
      </Row>
    </Section>
  );
}

function ProgressSection() {
  const [value, setValue] = useState(0.35);
  const [step, setStep] = useState(2);
  return (
    <Section title="Progress" note="Springs with restraint: fills use gentle, rings draw once when visible.">
      <ProgressBar value={value} aria-label="Profile completeness" />
      <ProgressBar aria-label="Uploading" />
      <Row>
        <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.max(0, +(v - 0.15).toFixed(2)))}>
          −15%
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setValue((v) => Math.min(1, +(v + 0.15).toFixed(2)))}>
          +15%
        </Button>
      </Row>
      <StepDots total={5} current={step} label />
      <Row>
        <Button size="sm" variant="secondary" disabled={step <= 1} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        <Button size="sm" disabled={step >= 5} onClick={() => setStep((s) => s + 1)}>
          Next step
        </Button>
      </Row>
      <div className="flex items-end gap-5">
        <ProgressRing value={value} size={40} />
        <ProgressRing value={0.87} size={64} aria-label="Compatibility" />
        <ProgressRing value={0.92} size={96} aria-label="Compatibility" />
      </div>
    </Section>
  );
}

function Identity({ incognito }: { incognito: boolean }) {
  if (incognito) {
    return (
      <Section title="Identity · incognito" note="Buzz never receives a user: emoji + alias colour only. No Avatar, no @handle.">
        <Card className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <AliasAvatar emoji="☄️" color="#38bdf8" />
            <span className="type-label-sm">Anon Comet</span>
            <OpBadge />
            <span className="type-caption text-ink-3">· 3m</span>
          </div>
          <div className="flex items-center gap-2">
            <AliasAvatar emoji="🦊" color="#fb923c" size="sm" />
            <span className="type-label-sm">Anon Fox</span>
            <Badge tone="accent">you</Badge>
          </div>
          <div className="flex items-center gap-2">
            <AliasAvatar emoji="🌵" color="#a3e635" size="sm" />
            <span className="type-label-sm">Anon Cactus</span>
          </div>
        </Card>
      </Section>
    );
  }
  return (
    <Section title="Identity · public" note="People are circles, orgs are rounded squares. A ring adds 8px.">
      <div className="flex flex-wrap items-end gap-3">
        <Avatar name="Maya Okafor" src={FACES.maya} size="xs" />
        <Avatar name="Maya Okafor" src={FACES.maya} size="sm" />
        <Avatar name="Maya Okafor" src={FACES.maya} size="md" />
        <Avatar name="Ethan Ng" src={FACES.ethan} size="lg" />
        <Avatar name="Chloe Dubois" src={FACES.chloe} size="xl" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name="Maya Okafor" src={FACES.maya} ring="orbit" size="lg" />
        <Avatar name="Ethan Ng" src={FACES.ethan} ring="seen" size="lg" />
        <Avatar name="Chloe Dubois" src={FACES.chloe} ring="live" size="lg" />
        <Avatar name="Ethan Ng" src={FACES.ethan} presence="online" size="lg" />
        <Avatar name="Longhorn Hackers" src={FACES.club} shape="org" badge="verified" size="lg" />
        <Avatar name="Isabella Rossi" size="lg" />
        <Avatar name="Film Society" shape="org" size="lg" onClick={() => toast.info('Avatar tapped')} />
      </div>
      <Row>
        <AvatarStack users={[{ name: 'Maya Okafor', src: FACES.maya }, { name: 'Ethan Ng', src: FACES.ethan }, { name: 'Chloe Dubois', src: FACES.chloe }]} total={27} />
        <AvatarStack size="xs" users={[{ name: 'Maya Okafor', src: FACES.maya }, { name: 'Longhorn Hackers', src: FACES.club, shape: 'org' }]} />
        <AvatarStack size="md" users={[{ name: 'Isabella Rossi' }, { name: 'Ethan Ng', src: FACES.ethan }, { name: 'Chloe Dubois', src: FACES.chloe }, { name: 'Maya Okafor' }]} />
      </Row>
    </Section>
  );
}

function Containers({ incognito }: { incognito: boolean }) {
  return (
    <Section title="Containers" note="In-list cards carry no shadow. Rows inside a card group have no border of their own.">
      <Card>
        <Card.Header>
          <IconDisc icon={CalendarDays} />
          <div className="min-w-0">
            <div className="truncate type-headline">Flat card</div>
            <div className="type-footnote text-ink-3">surface-1 + hairline border</div>
          </div>
        </Card.Header>
        <Card.Body className="type-body text-ink-2">Header, body and footer are optional parts; the footer draws its own divider.</Card.Body>
        <Card.Footer>
          <Button size="sm" variant="secondary">
            Details
          </Button>
          <Button size="sm">RSVP</Button>
        </Card.Footer>
      </Card>
      <Card variant="raised">
        <div className="type-headline">Raised card</div>
        <p className="mt-1 type-footnote text-ink-3">surface-2 with the top hairline highlight.</p>
      </Card>
      <Card variant="hero">
        <div className="type-headline">{incognito ? 'Be kind. Be anonymous.' : 'Apartments are coming'}</div>
        <p className="mt-1 type-footnote text-ink-2">Hero card: soft gradient + accent border. One per screen.</p>
      </Card>
      <div className="grid grid-cols-2 gap-3">
        <Card variant="media" onClick={() => toast.show('Card pressed')} aria-label={`Desk lamp, ${formatPrice(18, DEMO_CURRENCY)}`}>
          <img src={GALLERY[1]!.url} alt="" className="aspect-square w-full object-cover" />
          <div className="p-3">
            <div className="font-display text-lg font-semibold">{formatPrice(18, DEMO_CURRENCY)}</div>
            <div className="truncate type-footnote text-ink-2">Desk lamp, barely used</div>
          </div>
        </Card>
        <Card variant="media" to={KIT_PATH} aria-label={`Mini fridge, ${formatPrice(60, DEMO_CURRENCY)}`}>
          <img src={GALLERY[0]!.url} alt="" className="aspect-square w-full object-cover" />
          <div className="p-3">
            <div className="font-display text-lg font-semibold">{formatPrice(60, DEMO_CURRENCY)}</div>
            <div className="truncate type-footnote text-ink-2">Mini fridge · West Campus</div>
          </div>
        </Card>
      </div>

      <Label>ListRow</Label>
      <Card className="overflow-hidden p-0">
        <ListRow
          leading={incognito ? <IconDisc icon={VenetianMask} /> : <Avatar name="Ethan Ng" src={FACES.ethan} presence="online" />}
          title={incognito ? 'Someone replied to your buzz' : 'Ethan Ng'}
          subtitle={incognito ? '“honestly the PCL fourth floor is elite”' : 'Is the fridge still available?'}
          meta="2m"
          unread
          onClick={() => toast.show('Row pressed')}
        />
        <ListRow leading={<IconDisc icon={Store} />} title="Saved listings" trailing="chevron" to={KIT_PATH} />
        <ListRow leading={<IconDisc icon={ShieldCheck} />} title="Community Guidelines" subtitle="What is and is not okay here" trailing={<Badge tone="info">Updated</Badge>} onClick={() => undefined} />
        <ListRow leading={<IconDisc icon={Settings} />} title="Unavailable right now" subtitle="Disabled row" trailing="chevron" disabled onClick={() => undefined} />
        <ListRow leading={<IconDisc icon={Trash2} />} title="Delete account" destructive onClick={() => undefined} />
      </Card>
    </Section>
  );
}

function Overlays({ incognito }: { incognito: boolean }) {
  const [sheet, setSheet] = useState(false);
  const [detents, setDetents] = useState(false);
  const [locked, setLocked] = useState(false);
  const [actions, setActions] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [danger, setDanger] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [index, setIndex] = useState(0);
  const [reason, setReason] = useState('');
  const [sheetSort, setSheetSort] = useState<'new' | 'near' | 'cheap'>('new');
  const [sheetRange, setSheetRange] = useState<[number, number]>([20, 200]);

  return (
    <Section title="Overlays" note="All render in #overlay-root inside the frame and inherit this page's surface mode.">
      <Row>
        <Button variant="secondary" onClick={() => setSheet(true)} leftIcon={SlidersHorizontal}>
          Sheet · auto
        </Button>
        <Button variant="secondary" onClick={() => setDetents(true)}>
          Sheet · half ↔ full
        </Button>
        <Button variant="secondary" onClick={() => setLocked(true)}>
          Sheet · not dismissible
        </Button>
        <Button variant="secondary" onClick={() => setActions(true)}>
          ActionSheet
        </Button>
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          Dialog
        </Button>
        <Button variant="secondary" onClick={() => setDanger(true)}>
          Dialog · danger + async
        </Button>
        <Button variant="secondary" onClick={() => setPersistent(true)}>
          Dialog · persistent
        </Button>
        {incognito ? null : (
          <Button variant="secondary" onClick={() => setLightbox(true)}>
            Lightbox
          </Button>
        )}
      </Row>
      <Label>Toast</Label>
      <Row>
        <Button size="sm" variant="ghost" onClick={() => toast.success('Listing posted')}>
          Success
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toast.error("Couldn't send. Check your connection.")}>
          Error
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toast.info('Maya will see your request in Requests.')}>
          Info
        </Button>
        <Button size="sm" variant="ghost" onClick={() => toast.show('Removed from saved', { action: { label: 'Undo', onClick: () => toast.success('Restored') } })}>
          With action
        </Button>
      </Row>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        title="Filters"
        description="Drag the grabber, fling it down, tap the scrim or press Esc."
        footer={
          <Button fullWidth size="lg" onClick={() => setSheet(false)}>
            Show 42 listings
          </Button>
        }
      >
        <div className="flex flex-col gap-5 pb-2">
          <SegmentedControl
            aria-label="Sort"
            fullWidth
            value={sheetSort}
            onChange={setSheetSort}
            options={[
              { value: 'new', label: 'Newest' },
              { value: 'near', label: 'Nearest' },
              { value: 'cheap', label: 'Cheapest' },
            ]}
          />
          <RangeSlider label="Price" min={0} max={500} step={10} minGap={20} value={sheetRange} onChange={setSheetRange} format={(v) => `$${v}`} />
          <Select
            label="Condition"
            sheetTitle="Condition"
            value={null}
            onChange={() => undefined}
            placeholder="Any condition"
            options={[
              { value: 'new', label: 'Like new' },
              { value: 'good', label: 'Good' },
              { value: 'fair', label: 'Fair' },
            ]}
          />
        </div>
      </Sheet>

      <Sheet open={detents} onOpenChange={setDetents} title="Comments" detents={['half', 'full']} footer={<Input aria-label="Add a comment" placeholder="Add a comment" rightSlot={<IconButton icon={Send} aria-label="Send" size="sm" variant="accent" />} />}>
        <div className="-mx-4">
          {Array.from({ length: 14 }, (_, i) => (
            <ListRow
              key={i}
              leading={incognito ? <AliasAvatar emoji={['☄️', '🦊', '🌵', '🪐'][i % 4]!} color={['#38bdf8', '#fb923c', '#a3e635', '#f0abfc'][i % 4]!} /> : <Avatar name={['Maya Okafor', 'Ethan Ng', 'Chloe Dubois'][i % 3]!} src={[FACES.maya, FACES.ethan, FACES.chloe][i % 3]} />}
              title={incognito ? ['Anon Comet', 'Anon Fox', 'Anon Cactus', 'Anon Saturn'][i % 4] : ['Maya Okafor', 'Ethan Ng', 'Chloe Dubois'][i % 3]}
              subtitle="Pull the sheet up to full, scroll, then pull down from the top."
              meta={`${i + 1}m`}
            />
          ))}
        </div>
      </Sheet>

      <Sheet open={locked} onOpenChange={setLocked} title="One thing before you post" dismissible={false} footer={<Button fullWidth onClick={() => setLocked(false)}>I understand</Button>}>
        <p className="pb-2 type-body text-ink-2">A non-dismissible sheet resists the drag and ignores the scrim and Esc. Only its own action closes it.</p>
      </Sheet>

      <ActionSheet
        open={actions}
        onOpenChange={setActions}
        title={incognito ? 'Buzz' : 'Post'}
        actions={[
          { icon: Send, label: 'Share', onSelect: () => toast.show('Share sheet would open') },
          { icon: Link2, label: 'Copy link', onSelect: () => toast.success('Link copied') },
          { icon: Flag, label: 'Report', onSelect: () => toast.info('Report flow would open') },
          { icon: Trash2, label: 'Delete', destructive: true, onSelect: () => setDanger(true) },
        ]}
      />

      <Dialog open={confirm} onOpenChange={setConfirm} title="Leave without saving?" description="Your draft listing will be discarded." confirmLabel="Leave" cancelLabel="Stay" onConfirm={() => { toast.show('Draft discarded'); }} />
      <Dialog
        open={danger}
        onOpenChange={setDanger}
        tone="danger"
        icon={Trash2}
        title="Delete this post?"
        description="This can't be undone. Replies will be removed with it."
        confirmLabel="Delete post"
        onConfirm={() => new Promise<void>((resolve) => window.setTimeout(() => { toast.success('Post deleted'); resolve(); }, 1200))}
      />
      <Dialog
        open={persistent}
        onOpenChange={setPersistent}
        persistent
        icon={ShieldCheck}
        title="Add a reason"
        description="The scrim and Esc do nothing here. Confirm unlocks at 10 characters."
        confirmLabel="Continue"
        confirmDisabled={reason.trim().length < 10}
        onConfirm={() => setReason('')}
      >
        <Textarea aria-label="Reason" minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this needed?" />
      </Dialog>
      <Lightbox open={lightbox} onOpenChange={setLightbox} images={GALLERY} index={index} onIndexChange={setIndex} />
    </Section>
  );
}

function Feedback() {
  const [rows, setRows] = useState(6);
  const [fetching, setFetching] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const LIMIT = 24;

  const load = () => {
    if (fetching) return;
    setFetching(true);
    setError(null);
    window.setTimeout(() => {
      setFetching(false);
      if (failNext) {
        setFailNext(false);
        setError(new Error('network'));
      } else setRows((n) => Math.min(LIMIT, n + 6));
    }, 900);
  };

  return (
    <>
      <Section title="Skeleton" note="Same geometry as the content it stands in for. Static under reduced motion.">
        <Card className="flex items-center gap-3">
          <Skeleton circle w={40} />
          <div className="flex-1">
            <Skeleton w="45%" h={14} />
            <Skeleton w="70%" h={12} className="mt-2" />
          </div>
          <Skeleton w={72} h={36} className="rounded-full" />
        </Card>
        <Card>
          <SkeletonText lines={3} />
        </Card>
      </Section>

      <Section title="EmptyState & ErrorState">
        <Card className="flex min-h-[340px] flex-col p-0">
          <EmptyState icon={Store} title="No one's selling a mini-fridge… yet" description="Be the first. Listings from your campus show up here." action={{ label: 'List an item', onClick: () => toast.show('Composer would open') }} secondary={{ label: 'Clear filters', onClick: () => undefined }} />
        </Card>
        <Card className="p-0">
          <EmptyState compact icon={Bookmark} title="Nothing saved" description="Tap the bookmark on a listing to keep it here." />
        </Card>
        <Card className="flex min-h-[320px] flex-col p-0">
          <ErrorState title="Couldn't load listings" onRetry={() => toast.info('Retrying…')} />
        </Card>
        <Card className="p-0">
          <ErrorState inline title="Couldn't load more" onRetry={() => toast.info('Retrying…')} />
        </Card>
      </Section>

      <Section title="InfiniteSentinel" note="Loads 600px before the end, shows skeleton rows, an inline retry, then the end cap.">
        <Card className="p-0">
          <ListRow title="Fail the next page" subtitle="Shows the inline error with Retry" trailing={<Switch checked={failNext} onChange={setFailNext} aria-label="Fail the next page" />} />
        </Card>
        <Card className="overflow-hidden p-0">
          {Array.from({ length: rows }, (_, i) => (
            <ListRow key={i} leading={<IconDisc icon={BookOpen} />} title={`CS 3${10 + i} study group`} subtitle={`${8 + i} members · meets weekly`} trailing="chevron" onClick={() => undefined} />
          ))}
          <InfiniteSentinel
            onReach={load}
            hasMore={rows < LIMIT}
            isFetching={fetching}
            error={error ?? undefined}
            onRetry={load}
            skeleton={
              <div>
                {[0, 1].map((i) => (
                  <div key={i} className="flex min-h-17 items-center gap-3 px-4">
                    <Skeleton circle w={40} />
                    <div className="flex-1">
                      <Skeleton w="50%" h={14} />
                      <Skeleton w="35%" h={12} className="mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            }
          />
        </Card>
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ page */

export function KitGallery() {
  const [mode, setMode] = useState<SurfaceMode>('public');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const incognito = mode === 'incognito';

  return (
    <Surface mode={mode}>
      <Screen
        scrollRef={scrollRef}
        header={
          <PageHeader
            mode="large"
            title="UI kit"
            subtitle={incognito ? 'Incognito · Phosphor (Buzz only)' : 'Public · Aurora'}
            actions={<IconButton icon={Bell} aria-label="Fire a toast" badge={3} onClick={() => toast.info('Toasts stack two deep, swipe up to dismiss.')} />}
            below={
              <SegmentedControl
                aria-label="Surface mode"
                fullWidth
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'public', label: 'Aurora', icon: Sparkles },
                  { value: 'incognito', label: 'Incognito', icon: VenetianMask },
                ]}
              />
            }
          />
        }
      >
        <PullToRefresh onRefresh={() => new Promise((resolve) => window.setTimeout(resolve, 900)).then(() => toast.success('Refreshed'))}>
          <div className="flex flex-col gap-8 pt-2 pb-24">
            <Foundations />
            <Buttons incognito={incognito} />
            <IconButtons />
            <Fields incognito={incognito} />
            <Selection incognito={incognito} />
            <ProgressSection />
            <Identity incognito={incognito} />
            <Containers incognito={incognito} />
            <Overlays incognito={incognito} />
            <Feedback />
          </div>
        </PullToRefresh>
        <FAB
          icon={incognito ? PenLine : Plus}
          badgeIcon={incognito ? VenetianMask : undefined}
          label={incognito ? 'New buzz' : 'New post'}
          extended
          hideOnScroll={scrollRef}
          onClick={() => toast.show(incognito ? "You're anonymous here" : 'Composer would open')}
        />
      </Screen>
      <Toaster mode={mode} />
    </Surface>
  );
}

> **SUPERSEDED WHERE THEY DISAGREE:** `docs/SPEC.md` (esp. §2.3 deltas and rule R7 "no dead controls") and `docs/DECISIONS.md` override this document. Never build a control, route or endpoint from this file that SPEC does not declare.

# UniVerse — Design System (blueprint)

> Authority: `docs/CONSTITUTION.md` > `docs/SPEC.md` > this file. This file governs **how things look, move and
> are composed**. Routes, API shapes and export names belong to SPEC; where this file names a route or prop it is
> a sketch, and SPEC wins. Foundation implements everything in sections 1–6 under `client/src/app/**`,
> `client/src/ui/**`, `client/src/components/**`, `client/src/lib/**`. Slices consume it and never fork it.

## 0. Design principles (read once, apply everywhere)

1. **Deep space, not nightclub.** Near-black blue canvas, quiet surfaces, one accent per screen. Colour is a
   reward (active state, CTA, orbit ring), never wallpaper.
2. **Two worlds, one kit.** Every component reads *semantic slots* (`accent`, `canvas`, `surface-*`). The public
   world fills those slots with **Aurora** (violet → azure → cyan). The anonymous Buzz world fills them with
   **Phosphor** (lime on green-black). A component never hardcodes `brand-*` or `incog-*` for its accent.
3. **Hierarchy by type and space before colour and borders.** Sora for titles, Inter for everything else,
   16px gutters, 24px between sections.
4. **Elevation = lighter surface + hairline + soft shadow.** Glass is reserved for chrome that floats over
   scrolling content.
5. **Springs with restraint.** Things the finger touches respond in <100ms; nothing loops for decoration
   inside the phone frame except skeleton shimmer.
6. **No layout shift.** Every async region reserves its final box (skeletons match real geometry; media has
   an `aspect-ratio`).
7. **Every tappable thing is a real `<button>`/`<a>`, ≥44×44px, with a visible focus ring.**

### 0.1 Surface modes (the anonymity firewall, visually)

```tsx
// client/src/ui/Surface.tsx
type SurfaceMode = 'public' | 'incognito';
<Surface mode="incognito" className="...">…</Surface>
// renders <div data-surface="incognito"> and provides SurfaceContext
```

- `data-surface="incognito"` remaps the semantic CSS variables (section 1.3). Everything inside — buttons,
  chips, focus rings, switches, skeletons — turns Phosphor automatically.
- Portaled overlays (Sheet, Dialog, Toast) read `SurfaceContext` and stamp the same `data-surface` on their
  portal container, so a sheet opened from Buzz is Phosphor even though it renders in `#overlay-root`.
- **Only the `buzz` slice (and the Buzz portions of `admin`) may mount `mode="incognito"`.** Nothing in Buzz
  may render `Avatar`, `@handle`, aurora gradients or violet. Nothing outside Buzz may render `AliasAvatar`,
  Phosphor lime, or the mask glyph (except the Home tab indicator while it passes over "Buzz", and
  notification rows of Buzz origin, which use the mask glyph and *no* avatar).

---

## 1. Colour

### 1.1 Rules

- The default Tailwind palette is **wiped** (`--color-*: initial`). `bg-slate-800` does nothing. Use tokens.
- Opacity modifiers are fine on tokens (`bg-accent/15`, `text-ink/60`), but prefer the named `*-soft` and
  `ink-2/3/4` tiers so values stay consistent.
- Text tiers: `ink` (primary), `ink-2` (secondary, body-muted), `ink-3` (meta, placeholders, inactive icons),
  `ink-4` (disabled only — fails AA on purpose, never for readable content).
- All pairs below meet WCAG AA on `canvas` and `surface-1/2`: ink 16:1, ink-2 9:1, ink-3 5.2:1,
  accent-ink 7:1, white on `accent` 5.2:1, `on-accent` on Phosphor 15:1.

### 1.2 Tokens — paste into `client/src/app/styles/theme.css`

```css
@import "tailwindcss";

@theme {
  /* ---- reset defaults we do not want used ---- */
  --color-*: initial;

  --color-white: #ffffff;
  --color-black: #000000;

  /* ---- background layers (public / default) ---- */
  --color-void: #04050a;        /* desktop backdrop behind the phone frame */
  --color-canvas: #090b14;      /* app background */
  --color-surface-1: #10131f;   /* cards, list containers */
  --color-surface-2: #171b2b;   /* inputs, raised cards, sheets */
  --color-surface-3: #20253a;   /* chips, hover/pressed, dialogs */
  --color-surface-4: #2b3150;   /* selected rows, slider tracks, strongest fill */
  --color-scrim: rgb(2 3 8 / 0.64);           /* behind sheets/dialogs */
  --color-glass: rgb(16 19 31 / 0.72);        /* glass fill (see 3.4) */
  --color-glass-strong: rgb(16 19 31 / 0.88); /* glass fallback / reduced transparency */

  /* ---- borders ---- */
  --color-line-subtle: rgb(255 255 255 / 0.06);  /* dividers inside cards */
  --color-line: rgb(255 255 255 / 0.10);         /* card + input borders */
  --color-line-strong: rgb(255 255 255 / 0.18);  /* hover borders, phone frame */

  /* ---- text tiers ---- */
  --color-ink: #f2f4fb;
  --color-ink-2: #b6bcd2;
  --color-ink-3: #838ba8;
  --color-ink-4: #565e7a;
  --color-ink-inverse: #090b14;

  /* ---- brand: Aurora (public world) ---- */
  --color-brand-200: #d6ccff;
  --color-brand-300: #bcacff;
  --color-brand-400: #a08bff;   /* links / accent text on dark */
  --color-brand-500: #7c5cff;   /* icons, rings, indicators */
  --color-brand-600: #6d4ff2;   /* filled buttons (white text 5.2:1) */
  --color-brand-700: #5a3cd9;   /* pressed */
  --color-aurora-violet: #8b5cff;
  --color-aurora-azure: #5b7cff;
  --color-aurora-cyan: #22d3ee;
  --color-aurora-mint: #5eead4;
  --color-aurora-orchid: #c04dff;   /* backdrop blobs only */

  /* ---- incognito: Phosphor (Buzz world) ---- */
  --color-incog-200: #ecffad;
  --color-incog-300: #e0ff85;
  --color-incog-400: #d3fb5c;   /* accent text on incog canvas */
  --color-incog-500: #c5f53b;   /* fills, indicators */
  --color-incog-600: #a6d822;   /* pressed */
  --color-incog-700: #7da912;
  --color-incog-ink: #0c1400;   /* text on Phosphor fills */
  --color-incog-canvas: #070908;
  --color-incog-surface-1: #0e120f;
  --color-incog-surface-2: #151b16;
  --color-incog-surface-3: #1d261f;
  --color-incog-surface-4: #28342a;
  --color-incog-down: #ff8a65;  /* downvote only */

  /* ---- semantic slots (public defaults; remapped in 1.3) ---- */
  --color-accent: #6d4ff2;                     /* filled interactive */
  --color-accent-hover: #7c5cff;
  --color-accent-press: #5a3cd9;
  --color-accent-ink: #a08bff;                 /* accent-coloured text/icons on canvas */
  --color-accent-soft: rgb(124 92 255 / 0.16); /* selected chip, active nav pill */
  --color-accent-line: rgb(124 92 255 / 0.42); /* selected borders */
  --color-on-accent: #ffffff;
  --color-focus: #a08bff;                      /* focus ring */

  /* ---- semantic status ---- */
  --color-success: #34d399;
  --color-success-soft: rgb(52 211 153 / 0.14);
  --color-warning: #fbbf24;
  --color-warning-soft: rgb(251 191 36 / 0.14);
  --color-danger: #ff5a5f;                     /* text/icons */
  --color-danger-fill: #d5383e;                /* destructive buttons (white text) */
  --color-danger-soft: rgb(255 90 95 / 0.14);
  --color-info: #38bdf8;
  --color-info-soft: rgb(56 189 248 / 0.14);
  --color-love: #ff3d81;                       /* like heart only */
  --color-online: #3ddc97;                     /* presence dot only */
  --color-gold: #f5c451;                       /* verified org tick, "free" tag */

  /* ---- alias palette (Buzz AliasAvatar; index = aliasColor % 12) ---- */
  --color-alias-0: #f87171;  --color-alias-1: #fb923c;  --color-alias-2: #fbbf24;
  --color-alias-3: #a3e635;  --color-alias-4: #34d399;  --color-alias-5: #2dd4bf;
  --color-alias-6: #38bdf8;  --color-alias-7: #93a5ff;  --color-alias-8: #e5e7eb;
  --color-alias-9: #f0abfc;  --color-alias-10: #fb7185; --color-alias-11: #d6b98c;
}

/* gradients are not a Tailwind namespace: plain custom properties + utilities */
:root {
  --gradient-aurora: linear-gradient(135deg, #8b5cff 0%, #5b7cff 46%, #22d3ee 100%);
  --gradient-aurora-soft: linear-gradient(135deg, rgb(139 92 255 / .22), rgb(91 124 255 / .14) 46%, rgb(34 211 238 / .18));
  --gradient-aurora-ring: conic-gradient(from 210deg, #8b5cff, #5b7cff, #22d3ee, #5eead4, #8b5cff);
  --gradient-phosphor: linear-gradient(135deg, #e0ff85 0%, #c5f53b 52%, #6ee7a0 100%);
  --gradient-phosphor-soft: linear-gradient(135deg, rgb(197 245 59 / .16), rgb(110 231 160 / .08));
  --gradient-scrim-top: linear-gradient(to bottom, rgb(0 0 0 / .58), rgb(0 0 0 / 0));
  --gradient-scrim-bottom: linear-gradient(to top, rgb(0 0 0 / .72), rgb(0 0 0 / .28) 55%, rgb(0 0 0 / 0));
  --gradient-hero: var(--gradient-aurora);        /* slot: remapped in incognito */
  --gradient-hero-soft: var(--gradient-aurora-soft);
}
@utility bg-hero { background-image: var(--gradient-hero); }
@utility bg-hero-soft { background-image: var(--gradient-hero-soft); }
@utility bg-aurora-ring { background-image: var(--gradient-aurora-ring); }
@utility bg-scrim-top { background-image: var(--gradient-scrim-top); }
@utility bg-scrim-bottom { background-image: var(--gradient-scrim-bottom); }
@utility text-hero {
  background-image: var(--gradient-hero);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
```

### 1.3 Incognito remap (same file, after `@theme`)

```css
[data-surface="incognito"] {
  --color-canvas: #070908;
  --color-surface-1: #0e120f;
  --color-surface-2: #151b16;
  --color-surface-3: #1d261f;
  --color-surface-4: #28342a;
  --color-glass: rgb(14 18 15 / 0.76);
  --color-glass-strong: rgb(14 18 15 / 0.9);
  --color-ink-2: #b9c2b4;
  --color-ink-3: #869183;
  --color-ink-4: #586155;
  --color-accent: #c5f53b;
  --color-accent-hover: #d3fb5c;
  --color-accent-press: #a6d822;
  --color-accent-ink: #d3fb5c;
  --color-accent-soft: rgb(197 245 59 / 0.13);
  --color-accent-line: rgb(197 245 59 / 0.34);
  --color-on-accent: #0c1400;
  --color-focus: #d3fb5c;
  --gradient-hero: var(--gradient-phosphor);
  --gradient-hero-soft: var(--gradient-phosphor-soft);
  background-color: var(--color-canvas);
  color: var(--color-ink);
}
```

Use plain `@theme` (not `@theme inline`) so utilities compile to `var(--color-accent)` and the remap works at
runtime.

### 1.4 Usage map

| Need | Class |
|---|---|
| Screen background | `bg-canvas` |
| Card / grouped list | `bg-surface-1 border border-line` |
| Input, sheet body, raised card | `bg-surface-2` |
| Chip, pressed row, dialog | `bg-surface-3` |
| Primary CTA | `bg-accent text-on-accent` |
| One hero CTA per flow (Welcome, Get notified, Post) | `bg-hero text-on-accent` (public: white; incognito: `incog-ink`) |
| Link / accent text | `text-accent-ink` |
| Selected chip / active nav | `bg-accent-soft text-ink border-accent-line` |
| Like (active) | `text-love` + filled heart |
| Upvote / downvote (active) | `text-accent-ink` / `text-incog-down` |
| Destructive | text `text-danger`, fill `bg-danger-fill text-white` |

Where the two families meet: **never in the same viewport**, with two exceptions — mid-swipe between Home
panes, and the Home tab indicator. No gradient ever blends violet into lime.

---

## 2. Typography

### 2.1 Families (self-hosted, no CDN)

Installed: `@fontsource-variable/sora`, `@fontsource-variable/inter`. Import once in `client/src/main.tsx`:

```ts
import '@fontsource-variable/inter';   // wght 100–900
import '@fontsource-variable/sora';    // wght 100–800
```

```css
@theme {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-display: "Sora Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;   /* admin ids, dev code only */

  /* sizes keep Tailwind's key names but use OUR values */
  --text-2xs: 0.6875rem;  /* 11 */
  --text-xs: 0.75rem;     /* 12 */
  --text-sm: 0.8125rem;   /* 13 */
  --text-base: 0.9375rem; /* 15 */
  --text-md: 1rem;        /* 16 */
  --text-lg: 1.0625rem;   /* 17 */
  --text-xl: 1.125rem;    /* 18 */
  --text-2xl: 1.375rem;   /* 22 */
  --text-3xl: 1.75rem;    /* 28 */
  --text-4xl: 2.125rem;   /* 34 */
  --text-5xl: 2.75rem;    /* 44 */
}
```

- **Sora** = display voice: wordmark, page titles, section headers, prices, big numbers, Home tab labels.
- **Inter** = everything readable: body, labels, buttons, inputs, meta. Enable `font-feature-settings: "cv11", "ss01"`
  on `body` (single-storey a off, open digits) and `font-optical-sizing: auto`.
- Wordmark: `<span class="font-display font-normal">uni</span><span class="font-display font-bold">verse</span>`,
  lowercase, tracking −0.03em, rendered from `APP_NAME` by `components/Wordmark.tsx` (splits at index 3).

### 2.2 Type roles — the only way to set text

Engineers use the `type-*` role utilities, not raw size/weight combos. Raw `text-*` sizes exist for rare
one-offs (badge counts, chart labels).

```css
@utility type-display   { font-family: var(--font-display); font-size: 2.125rem; line-height: 2.5rem;   font-weight: 700; letter-spacing: -0.025em; }
@utility type-title-1   { font-family: var(--font-display); font-size: 1.75rem;  line-height: 2.125rem; font-weight: 700; letter-spacing: -0.02em; }
@utility type-title-2   { font-family: var(--font-display); font-size: 1.375rem; line-height: 1.75rem;  font-weight: 600; letter-spacing: -0.015em; }
@utility type-title-3   { font-family: var(--font-display); font-size: 1.125rem; line-height: 1.5rem;   font-weight: 600; letter-spacing: -0.01em; }
@utility type-headline  { font-family: var(--font-sans); font-size: 1rem;      line-height: 1.375rem; font-weight: 600; letter-spacing: -0.01em; }
@utility type-body-lg   { font-family: var(--font-sans); font-size: 1.0625rem; line-height: 1.625rem; font-weight: 400; letter-spacing: -0.008em; }
@utility type-body      { font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.375rem; font-weight: 400; letter-spacing: -0.005em; }
@utility type-footnote  { font-family: var(--font-sans); font-size: 0.8125rem; line-height: 1.125rem; font-weight: 400; letter-spacing: 0; }
@utility type-caption   { font-family: var(--font-sans); font-size: 0.75rem;   line-height: 1rem;     font-weight: 500; letter-spacing: 0.005em; }
@utility type-micro     { font-family: var(--font-sans); font-size: 0.6875rem; line-height: 0.875rem; font-weight: 600; letter-spacing: 0.02em; }
@utility type-overline  { font-family: var(--font-sans); font-size: 0.6875rem; line-height: 0.875rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
@utility type-label     { font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.25rem;  font-weight: 600; letter-spacing: -0.005em; }
@utility type-label-sm  { font-family: var(--font-sans); font-size: 0.8125rem; line-height: 1rem;     font-weight: 600; letter-spacing: 0; }
```

| Role | px / lh | Use |
|---|---|---|
| `type-display` | 34/40 Sora 700 | Welcome hero, Apartments "Coming soon", onboarding step titles |
| `type-title-1` | 28/34 Sora 700 | Large `PageHeader` titles on root tabs (Discover, Messages, Roommates, Marketplace) |
| `type-title-2` | 22/28 Sora 600 | Profile name, listing price, event title, compatibility %, EmptyState title |
| `type-title-3` | 18/24 Sora 600 | Section headers, compact `PageHeader` title, Sheet/Dialog titles, Home tab labels (16px override) |
| `type-headline` | 16/22 Inter 600 | Names in rows, card titles, listing titles, **all input text (16px prevents iOS zoom)** at weight 400 |
| `type-body-lg` | 17/26 Inter 400 | Buzz thread root text, Orbit post detail body, guidelines prose |
| `type-body` | 15/22 Inter 400 | Default. Feed text, chat bubbles, descriptions |
| `type-footnote` | 13/18 Inter 400 | Secondary lines in rows, helper text, bios in cards |
| `type-caption` | 12/16 Inter 500 | Timestamps, counts, meta, nav label, chip-sm text |
| `type-micro` | 11/14 Inter 600 | Badges, unread counts |
| `type-overline` | 11/14 Inter 600 caps | Group labels in Settings/Admin, "YOU'RE ANONYMOUS" banner |
| `type-label` / `-sm` | 15/20, 13/16 Inter 600 | Button and chip labels |

Rules: max two Sora roles per screen region. Counts, prices, timers, OTP and percentages get `tabular-nums`.
Prices use `font-display`. Truncate with `truncate` / `line-clamp-2`; never shrink text to fit. Body copy max
width is the frame; no justified text. Emoji render at the surrounding size (no emoji-only enlargement except
single-emoji chat bubbles at 34px).

---

## 3. Space, shape, depth

### 3.1 Spacing

Base unit 4px (`--spacing: 0.25rem`, Tailwind default scale). Allowed steps: 0, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8,
10, 12, 16 (= 0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64px).

| Token | Value | Use |
|---|---|---|
| Screen gutter | 16px (`px-4`) | Every screen's horizontal padding. Full-bleed media and carousels break it; their first item re-aligns to 16px. |
| Section gap | 24px (`gap-6`) | Between titled sections. 32px before the first section under a large header. |
| Card padding | 16px (`p-4`) | 12px for compact cards in 2-col grids. |
| Row padding | 12px vertical, 16px horizontal | `ListRow` min-height 56 (one line) / 68 (two lines). |
| Inline gap | 8px icon↔label, 12px avatar↔text, 8px between chips | |
| Grid | 2 columns, 12px gap (Marketplace, reels grid uses 3 columns, 2px gap) | |
| Hit target | min 44×44 | Visual can be smaller; pad the button. |

### 3.2 Radii

```css
@theme {
  --radius-xs: 6px;    /* badges-square, image corner in bubbles */
  --radius-sm: 10px;   /* thumbnails, small cards, segmented thumb */
  --radius-md: 14px;   /* inputs, textarea, select, menus */
  --radius-lg: 20px;   /* cards, dialogs, media in feed */
  --radius-xl: 28px;   /* sheets (top corners), hero cards */
  --radius-2xl: 36px;
  --radius-3xl: 44px;  /* phone frame */
}
```

Buttons, chips, badges, nav, FAB, segmented control, search field: `rounded-full`. Inputs: `rounded-md`.
Cards: `rounded-lg`. Nested radius = outer − padding (a 20px card with 8px inset holds 12px thumbnails →
use `rounded-sm`/12px). Chat bubbles: 20px with the 6px "tail corner" on the sender side.

### 3.3 Elevation

Dark UIs get depth from lightness first. Shadows are wide, soft and mostly black.

```css
@theme {
  --shadow-*: initial;
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.4);
  --shadow-md: 0 8px 24px -6px rgb(0 0 0 / 0.55), 0 2px 6px rgb(0 0 0 / 0.35);        /* cards that float: menus, toasts */
  --shadow-lg: 0 24px 64px -12px rgb(0 0 0 / 0.7), 0 8px 20px rgb(0 0 0 / 0.4);       /* sheets, dialogs, nav */
  --shadow-frame: 0 40px 120px -20px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(255 255 255 / 0.08); /* desktop phone frame */
  --shadow-glow: 0 0 0 1px var(--color-accent-line), 0 8px 28px -6px var(--color-accent-soft); /* hero CTA, FAB */
  --inset-shadow-hairline: inset 0 1px 0 rgb(255 255 255 / 0.06);                       /* top highlight on raised things */
}
```

| Level | Recipe | Used by |
|---|---|---|
| 0 | `bg-canvas` | screens |
| 1 | `bg-surface-1 border border-line` (no shadow) | cards, grouped lists |
| 2 | `bg-surface-2 border border-line inset-shadow-hairline` | inputs, raised cards, sheet body |
| 3 | `bg-surface-3 shadow-md` | menus, popovers, toasts, dialogs (`shadow-lg`) |
| Float | glass recipe + `shadow-lg` | bottom nav, Home top bar, FAB (solid, `shadow-glow`) |

In-list cards never carry shadows (scroll performance, visual noise).

### 3.4 Glass

```css
@utility glass {
  background-color: var(--color-glass);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--color-line);
  box-shadow: var(--inset-shadow-hairline), var(--shadow-lg);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background-color: var(--color-glass-strong); }
}
@media (prefers-reduced-transparency: reduce) { .glass { background-color: var(--color-glass-strong); backdrop-filter: none; } }
```

**Allowed (exhaustive):** bottom nav · Home top bar over Buzz/Orbit · compact `PageHeader` once content has
scrolled under it · Toast · the chat composer bar · Reels overlay pills (mute, campus tag; use
`bg-black/35 backdrop-blur-md`, no border) · sticky filter bar in Marketplace/Roommates once stuck.
Sheet/Dialog **scrims** use `bg-scrim` + `backdrop-blur-[6px]`; the sheet body itself is solid `surface-2`.

**Forbidden:** glass on anything that scrolls with content (cards, rows, bubbles), glass on glass, glass on
inputs/buttons, more than two glass layers in a viewport, blur radius above 24px.

### 3.5 Z-index

```css
@theme { --z-sticky: 10; --z-topbar: 30; --z-fab: 35; --z-nav: 40; --z-scrim: 50; --z-sheet: 51; --z-dialog: 60; --z-toast: 70; }
```
Use as `z-(--z-nav)`. No other z-index values above 5 anywhere.

---

## 4. Motion

### 4.1 Presets — `client/src/lib/motion.ts` (single source; never inline numbers)

```ts
import type { Transition, Variants } from 'motion/react';

export const spring = {
  snappy: { type: 'spring', stiffness: 520, damping: 38, mass: 1 },   // taps, toggles, chips, nav pill, switch thumb
  smooth: { type: 'spring', stiffness: 320, damping: 32, mass: 1 },   // sheets, dialogs, pushed screens, FAB show/hide
  gentle: { type: 'spring', stiffness: 180, damping: 26, mass: 1 },   // hero entrances, onboarding step change, progress fill
  bouncy: { type: 'spring', stiffness: 420, damping: 17, mass: 0.9 }, // celebration ONLY: like burst, match %, RSVP tick, waitlist success
  settle: { type: 'spring', stiffness: 400, damping: 40, mass: 1 },   // drag release (sheet snap, pull-to-refresh) — pass gesture velocity
} satisfies Record<string, Transition>;

export const duration = { instant: 0.09, fast: 0.15, base: 0.22, slow: 0.32 } as const;   // seconds, for tweens
export const ease = {
  out: [0.22, 1, 0.36, 1],      // entrances, colour/opacity changes
  inOut: [0.65, 0, 0.35, 1],    // crossfades, indicator colour
  in: [0.4, 0, 1, 1],           // exits
} as const;

export const press = { whileTap: { scale: 0.97 }, transition: spring.snappy };      // buttons, cards that navigate
export const pressIcon = { whileTap: { scale: 0.9 }, transition: spring.snappy };   // icon buttons
export const fadeUp: Variants = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: spring.smooth } };
export const stagger = (step = 0.04) => ({ show: { transition: { staggerChildren: step, delayChildren: 0.02 } } });
```

CSS equivalents for non-motion elements: `--ease-out: cubic-bezier(0.22,1,0.36,1)`, `--ease-in-out:
cubic-bezier(0.65,0,0.35,1)`; `transition-colors duration-150 ease-out` is the standard hover/active colour
transition.

### 4.2 Choreography

| Thing | Motion |
|---|---|
| Button / card press | scale 0.97 (`snappy`), colour 150ms. No ripple. |
| Bottom nav active change | `layout` animation on the pill + label width (`snappy`); label opacity 0→1 over 150ms after 40ms |
| Root tab switch (bottom nav) | **No slide.** New screen fades in 0→1 over 150ms; scroll position restored |
| Pushed screen (detail, thread, chat) | enter `x: 24→0, opacity 0→1` (`smooth`); exit `opacity → 0` 120ms `ease.in`. Back = reverse |
| Sheet | `y: 100%→0` (`smooth`); scrim opacity 220ms. Drag follows finger 1:1; release uses `settle` with velocity |
| Dialog | `scale .94→1, opacity 0→1, y: 8→0` (`smooth`); exit 120ms fade |
| Toast | from top: `y: -16→0, opacity` (`smooth`); auto-dismiss fades 150ms; swipe up to dismiss |
| List first paint | `fadeUp` with `stagger(0.04)`, **first 8 items only**, first page only. Paginated items appear with a 150ms fade, no translate |
| Skeleton → content | crossfade 150ms; shimmer sweep 1.4s linear infinite, 12% white band |
| Like | heart: `bouncy` scale 0.6→1 + 6 particle dots (public only); count rolls vertically 150ms |
| Vote (Buzz) | arrow nudges 3px up/down and returns (`snappy`); score crossfades. No particles in Buzz — incognito is calm |
| Home tab indicator | scroll-linked (no spring; it is the finger). Section 6.4 |
| Segmented / Tabs thumb | shared `layoutId` thumb (`snappy`) |
| Switch | thumb x (`snappy`), track colour 150ms |
| Progress / compat ring | value tween via `gentle`; draws once when 40% visible |
| Orbit ring `live` | one dot orbits the avatar, 8s linear infinite |
| Desktop aurora backdrop | blobs drift ±4% over 60s ease-in-out alternate. Outside the frame only |
| Reel fallback poster | Ken Burns scale 1→1.08 over 12s alternate + progress bar |

### 4.3 Never

- Never animate `width/height/top/left/margin` by hand — use `layout` or transforms. Never animate `box-shadow`
  or `backdrop-filter` values (toggle opacity of a pre-rendered layer instead).
- Never animate text colour on scroll, never parallax, never auto-carousel, never bounce on navigation,
  never delay content behind an entrance longer than 250ms total.
- No infinite animations inside the frame other than: skeleton shimmer, `live` orbit dot, typing dots,
  recording/upload progress, reel poster fallback.
- `bouncy` appears at most once per user action and never on destructive or moderation UI.
- `AnimatePresence` exits must finish ≤150ms so navigation never feels blocked.

### 4.4 Reduced motion

Wrap the app in `<MotionConfig reducedMotion="user" transition={spring.smooth}>`. Additionally, a
`useReducedMotion()` branch in the kit guarantees:

- Transforms (slide/scale/stagger/particles/Ken Burns/orbit dot/backdrop drift) → **removed**; replaced by
  opacity fades ≤150ms. Sheets and dialogs fade; drag-to-dismiss still works, release snaps with a 120ms tween.
- Skeleton shimmer → static `surface-3` blocks. Count roll → instant swap.
- Pager and tab taps use `scrollTo({ behavior: 'auto' })`; global CSS sets `scroll-behavior: auto`.
- Reels still autoplay (content, not decoration) but the *poster fallback* is static with a play glyph.
- CSS guard: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important;
  animation-iteration-count: 1 !important; transition-duration: .01ms !important; } }` with `.motion-safe-keep`
  opt-out for progress bars.

---

## 5. Foundation UI kit — `client/src/ui/*`

Conventions for every component:

- One file per component, named export, barrel `client/src/ui/index.ts`. `className` is always accepted and
  merged last with `cn()` (`clsx` + `tailwind-merge`, in `client/src/lib/cn.ts`). Refs forwarded (React 19 `ref` prop).
- Shared size vocabulary: `sm | md | lg`. Control heights: **sm 36 · md 44 · lg 52** (sm controls still get a
  44px hit area through `before:absolute before:-inset-1` padding).
- Shared states: default · hover (pointer devices only, `@media (hover:hover)`) · pressed · focus-visible ·
  disabled (`opacity-45`, `pointer-events-none`, `aria-disabled`) · loading (keeps width, content → skeleton or
  3-dot pulse, `aria-busy`).
- Focus ring (global utility): `@utility focus-ring { outline: 2px solid var(--color-focus); outline-offset: 2px; }`
  applied on `:focus-visible`. Never removed.
- Accent comes from slots, so every component is automatically correct in both surface modes.

### 5.1 Actions

**Button** — the only way to render a text action.
- Variants: `primary` (`bg-accent text-on-accent`) · `hero` (`bg-hero text-on-accent shadow-glow`, max one per
  screen) · `secondary` (`bg-surface-3 text-ink border border-line`) · `ghost` (transparent, `text-ink-2`,
  pressed `bg-surface-2`) · `outline` (`border-accent-line text-accent-ink`) · `danger` (`bg-danger-fill text-white`)
  · `danger-ghost` (`text-danger`).
- Sizes: sm 36 / px-3.5 / `type-label-sm` · md 44 / px-5 / `type-label` · lg 52 / px-6 / `type-label`. Shape `rounded-full`.
- States: hover = `accent-hover`; pressed = `accent-press` + scale .97; loading = label fades to 3 pulsing dots,
  width locked; disabled.
```ts
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary'|'hero'|'secondary'|'ghost'|'outline'|'danger'|'danger-ghost'; // default 'primary'
  size?: 'sm'|'md'|'lg';            // default 'md'
  fullWidth?: boolean; loading?: boolean;
  leftIcon?: LucideIcon; rightIcon?: LucideIcon;
  asChild?: boolean;                // render as <Link>
}
```
Special case `FollowButton` (in `components/`): sm, `primary` "Follow" ↔ `secondary` "Following" with check,
optimistic, width locked to the longer label.

**IconButton** — icon-only action. Requires `aria-label`.
- Variants: `ghost` (default) · `filled` (`bg-surface-3`) · `glass` (over media: `bg-black/35 backdrop-blur-md text-white`)
  · `accent`. Sizes: sm 36 (icon 18) · md 44 (icon 20) · lg 52 (icon 24). Round. Optional `badge?: number | 'dot'`.
- `active?: boolean` with `activeTone?: 'accent'|'love'` fills the icon (heart/bookmark only).

**FAB** — the screen's single create action (compose Buzz, new post, new listing, new chat).
- 56×56 round, `bg-hero text-on-accent shadow-glow`, icon 24. Position `absolute right-4`,
  `bottom: calc(var(--nav-clearance) + 4px)`. `extended` variant: 52 high pill with label, collapses to round
  after the list scrolls 80px. Hides (`y: 96`, `smooth`) while scrolling down, returns on scroll up.
- In Buzz the FAB icon is `VenetianMask`+`Plus` composite (`PenLine` with mask badge); in public it is `Plus`.
```ts
interface FABProps { icon: LucideIcon; label: string; extended?: boolean; onClick(): void; hideOnScroll?: RefObject<HTMLElement>; }
```

### 5.2 Form controls

All fields share `Field` chrome: label (`type-footnote text-ink-2`, 6px above), control, then helper or error
(`type-footnote`, error = `text-danger` with `CircleAlert` 14px, `aria-describedby`). Control chrome:
`bg-surface-2 border border-line rounded-md`; hover `border-line-strong`; focus `border-accent-line` + 3px
`accent-soft` outer ring (box-shadow, not outline); invalid `border-danger/60`; disabled `opacity-45`.
**Input text is 16px** (`text-md`, weight 400), placeholder `text-ink-3`.

**Input** — sizes md 44 / lg 52. `variant: 'field' | 'search'` (search = `rounded-full`, `Search` icon left,
clear `X` button right when non-empty). Slots `leftIcon`, `rightSlot`, `prefix` (e.g. `$`, `@`).
```ts
interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'|'prefix'> {
  label?: string; helper?: string; error?: string; size?: 'md'|'lg';
  variant?: 'field'|'search'; leftIcon?: LucideIcon; rightSlot?: ReactNode; prefix?: string; onClear?(): void;
}
```

**Textarea** — auto-grows from `minRows` (default 3) to `maxRows` (default 8) then scrolls. Optional
`maxLength` shows a counter bottom-right (`type-caption`, turns `warning` at 90%, `danger` at 100%).
`variant: 'field' | 'bare'` (bare = no chrome, for composers; `type-body-lg`).

**Select** — a button styled like Input with `ChevronDown`; opens a **Sheet** with a radio list (never a
native dropdown popup, never a desktop popover). `multiple` → checkbox list with "Done".
```ts
interface SelectProps<T extends string> { label?: string; value: T | null; onChange(v: T): void;
  options: { value: T; label: string; description?: string; icon?: LucideIcon }[]; placeholder?: string; error?: string; sheetTitle?: string; }
```

**Switch** — 52×32 track, 26px thumb. Off `bg-surface-4`, on `bg-accent`; thumb white (public) / `incog-ink` on
Phosphor. `role="switch"`. Always paired with a label through `ListRow` trailing slot.

**Slider / RangeSlider** — track 4px `bg-surface-4`, filled part `bg-accent`, thumb 24px white with
`shadow-md`, 44px hit area, value bubble appears above the thumb while dragging (`type-caption tabular-nums`).
`RangeSlider` = two thumbs with `minGap`. Keyboard: arrows ± step, PageUp/Down ± 10%. Used for budget (Roommates),
price (Marketplace), video trim (Reels upload).
```ts
interface SliderProps { min: number; max: number; step?: number; value: number; onChange(v: number): void; format?(v: number): string; label?: string; }
interface RangeSliderProps extends Omit<SliderProps,'value'|'onChange'> { value: [number, number]; onChange(v: [number, number]): void; minGap?: number; }
```

**OTPInput** — six 48×56 cells, gap 8 (extra 16 between cell 3 and 4), `bg-surface-2 rounded-md`, digit
`type-title-2 tabular-nums`. One hidden-in-plain-sight real `<input inputMode="numeric"
autoComplete="one-time-code" maxLength={6}>` stretched over the cells (paste and SMS autofill just work).
Active cell: `border-accent-line` + soft caret blink. States: `error` (cells shake 6px ×2 `snappy`, border
danger, then clear), `success` (borders `success`, check draws), `disabled` while verifying. Calls
`onComplete(code)` at 6 digits.
```ts
interface OTPInputProps { value: string; onChange(v: string): void; onComplete?(v: string): void; length?: 6; status?: 'idle'|'verifying'|'error'|'success'; autoFocus?: boolean; }
```

### 5.3 Selection & navigation

**Chip** — filter / choice / tag pill. Sizes sm 32 (`type-caption`) · md 36 (`type-label-sm`); hit area 44.
- Variants: `filter` (toggle: off `bg-surface-2 border-line text-ink-2`, on `bg-accent-soft border-accent-line text-ink`)
  · `choice` (same look, radio semantics inside `ChipGroup`) · `tag` (static, `bg-surface-3 text-ink-2`, not a button)
  · `removable` (trailing `X`). Optional `leftIcon`, `count`.
- `ChipGroup` handles single/multi selection, wraps or scrolls horizontally (`scroll="x"` adds edge fade masks and
  `overscroll-behavior-x: contain` so it never drags the Home pager).

**Badge** — non-interactive status. Variants: `count` (min 18×18 round, `bg-accent text-on-accent type-micro`,
"99+"), `dot` (8px), `soft` (tone = `neutral|accent|success|warning|danger|info|gold`, `bg-*-soft text-*`,
`rounded-full px-2 h-5 type-micro`), `outline`. Specials built on it: `VerifiedBadge` (gold `BadgeCheck`
for orgs), `OpBadge` ("OP", incognito accent), `CampusBadge` (GraduationCap + university short name).

**SegmentedControl** — 2–4 mutually exclusive views of the same data (Hot/New/Top, Campus/Global,
Browse/My listing). Container `bg-surface-2 rounded-full p-1 h-11`; thumb `bg-surface-4 rounded-full shadow-sm`
moves with shared `layoutId`; labels `type-label-sm`, active `text-ink`, inactive `text-ink-3`. `fullWidth`
divides equally. `size: 'sm'` = h-9.
```ts
interface SegmentedControlProps<T extends string> { value: T; onChange(v: T): void; options: { value: T; label: string; icon?: LucideIcon }[]; size?: 'sm'|'md'; fullWidth?: boolean; 'aria-label': string; }
```

**Tabs** — in-page sections with different content (Profile: Posts/Reels/About; Admin: Queue/Reports/Audit).
Underline style: labels `type-label`, inactive `text-ink-3`, active `text-ink` + 2px `bg-accent` underline,
24px wide min, sliding via `layoutId`; bar has `border-b border-line-subtle`; `scrollable` for >4 tabs.
`role="tablist"`, arrow-key navigation. Sticky under the PageHeader when used on profiles.
Rule of thumb: *Segmented = filter, Tabs = different content.*

**Stepper / Progress** — three exports:
- `ProgressBar` — 4px track `surface-4`, fill `bg-hero`, `value 0–1`, indeterminate variant (upload).
- `StepDots` — onboarding/questionnaire: N segments (each a 4px bar, gap 4), completed `bg-accent`, current
  animates fill, upcoming `surface-4`. Label "Step 2 of 5" `type-caption` optional.
- `ProgressRing` — circular (sizes 40/64/96), 4–6px stroke, gradient stroke via `--gradient-hero` stops, centre
  label `tabular-nums`. Used for roommate compatibility % and profile completeness.
- `NumberStepper` — `−  2  +` control (IconButton sm ×2 + value) for counts such as bedrooms or quantity.

### 5.4 Identity

**Avatar** — real people and orgs only. Always an image (`/uploads/...` or DiceBear SVG) with initials fallback
on `surface-3`. **People are circles; orgs are rounded squares (radius 30%)** so account type reads at a glance.
- Sizes: xs 24 · sm 32 · md 40 · lg 56 · xl 80 · 2xl 104.
- `ring`: `none` · `orbit` (2px `bg-aurora-ring` conic ring with a 2px `canvas` gap — "new activity in your
  orbit", also always on *your own* avatar in the Home top bar) · `seen` (1.5px `line-strong`) · `live`
  (orbit ring + 6px dot circling at 8s). Ring adds 8px to the outer box; layout must reserve it.
- `presence?: 'online'|'offline'` → 10px `online` dot, 2px canvas border, bottom-right (Messages only).
- `badge?: 'verified'` → gold tick bottom-right for orgs (lg+ sizes).
```ts
interface AvatarProps { src?: string | null; name: string; size?: 'xs'|'sm'|'md'|'lg'|'xl'|'2xl'; shape?: 'circle'|'org';
  ring?: 'none'|'orbit'|'seen'|'live'; presence?: 'online'|'offline'; badge?: 'verified'; onClick?(): void; }
```
`AvatarStack` (max 3 + "+N") for group chats, RSVPs, mutuals.

**AliasAvatar** — Buzz only; a *separate component* so an anonymous surface can never be handed a user.
Circle, emoji centred at 55% of the box, background = alias colour at 16% alpha, **1.5px dashed ring** in the
alias colour. Sizes sm 28 · md 36. Never an image, never an orbit ring, never clickable. Paired with the label
(`type-label-sm`, e.g. "Anon Comet") + optional `OpBadge` + "you" soft badge when `isMine`.
```ts
interface AliasAvatarProps { emoji: string; color: number | string; size?: 'sm'|'md'; }
```

### 5.5 Containers

**Card** — `bg-surface-1 border border-line rounded-lg p-4`. Variants: `flat` (default) · `raised`
(`surface-2` + hairline) · `hero` (`bg-hero-soft` + `border-accent-line`, for promos/banners, max one per screen)
· `media` (p-0, overflow hidden, image on top). `interactive` adds press scale + `hover:border-line-strong` and
renders as `<button>`/`<Link>`. Sub-parts: `Card.Header`, `Card.Body`, `Card.Footer` (top `line-subtle` divider).

**ListRow** — the universal row (settings, people, conversations, notifications, search results).
Layout: `[leading 40–56] 12px [title + subtitle, flex-1, truncating] 12px [trailing]`. Min-height 56/68,
`px-4 py-3`. Pressed `bg-surface-2`. Divider = inset `line-subtle` starting at the text column. Inside a Card
group the group has the border and rows have none.
```ts
interface ListRowProps { leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; meta?: ReactNode; // meta = top-right timestamp
  trailing?: ReactNode | 'chevron'; onClick?(): void; to?: string; unread?: boolean; destructive?: boolean; disabled?: boolean; }
```
`unread` → title weight 600 + 8px accent dot in trailing column.

**PageHeader** — top of every non-Home screen. Two modes:
- `large` (root tabs): 52px bar (safe-top padded) with trailing actions, then a `type-title-1` title row (44px)
  that scrolls away; the bar fades in a centred `type-title-3` title + glass background once the large title
  has scrolled under (IntersectionObserver sentinel, not scroll listeners).
- `compact` (pushed screens): 52px bar: leading back `IconButton` (`ChevronLeft`) · centred/left title
  `type-title-3` + optional subtitle `type-caption text-ink-3` · up to 2 trailing `IconButton`s. Transparent at
  scroll 0, glass after.
```ts
interface PageHeaderProps { title: ReactNode; subtitle?: ReactNode; mode?: 'large'|'compact'; back?: boolean | (() => void);
  actions?: ReactNode; below?: ReactNode; /* sticky slot: search field, SegmentedControl, chips */ transparent?: boolean; }
```

**Sheet** — bottom sheet, the default overlay for menus, filters, pickers, comments, composers-lite, report flow.
- Anatomy: scrim (`bg-scrim backdrop-blur-[6px]`) → panel `bg-surface-2 rounded-t-xl shadow-lg border-t border-line`
  → 36×4 grabber (`surface-4`, 8px from top) → optional header (title `type-title-3`, close IconButton) → scroll
  body (`px-4`, `overscroll-behavior: contain`) → optional sticky footer (`p-4` + safe-bottom, top divider).
- Sizes via `detents`: `'auto'` (content height, max 90%) · `'half'` (56%) · `'full'` (100% − safe-top − 12px).
  Multiple detents allowed: `['half','full']` (comments).
- Drag-to-dismiss: `motion.div drag="y"` with `dragConstraints={{top:0}}`, `dragElastic={{top:0.04,bottom:0.6}}`.
  Drag starts from grabber/header always, and from the body only when body `scrollTop === 0`. Dismiss if
  offset > 28% of height **or** velocity > 600px/s; otherwise `settle` back/between detents. Scrim opacity is
  linked to drag progress.
- A11y: `role="dialog" aria-modal`, focus trapped, Esc and scrim tap close, focus returns to trigger, body scroll
  locked. Keyboard open → panel lifts using `visualViewport` inset. Rendered in `#overlay-root` (inside the frame).
```ts
interface SheetProps { open: boolean; onOpenChange(o: boolean): void; title?: ReactNode; description?: ReactNode;
  detents?: Array<'auto'|'half'|'full'>; initialDetent?: number; footer?: ReactNode; dismissible?: boolean; children: ReactNode; }
```
`ActionSheet` helper = Sheet + list of `{icon,label,destructive,onSelect}` rows + separated "Cancel" button.

**Dialog** — interrupting decisions only (confirm delete, block, unmask-with-reason, leave without saving).
Centred, width `calc(100% − 48px)` max 340, `bg-surface-3 rounded-lg p-6 shadow-lg`. Optional 48px tone icon
disc on top, title `type-title-3`, body `type-body text-ink-2`, actions stacked full-width (primary on top,
`ghost` cancel below) — side by side only when both labels ≤ 8 chars. `tone: 'default'|'danger'`. Not
drag-dismissible; scrim tap closes unless `persistent`.
```ts
interface DialogProps { open: boolean; onOpenChange(o: boolean): void; title: string; description?: ReactNode; icon?: LucideIcon;
  tone?: 'default'|'danger'; confirmLabel: string; cancelLabel?: string; onConfirm(): void | Promise<void>; persistent?: boolean; children?: ReactNode; }
```

### 5.6 Feedback & async

**Toast** — imperative `toast.success|error|info|show()` from `client/src/lib/toast.ts` (zustand store) +
`<Toaster/>` in the shell. Top-centre under safe-top (bottom is owned by nav), glass pill `rounded-lg px-4 py-3`,
leading tone icon, `type-footnote` 2 lines max, optional action button (`type-label-sm text-accent-ink`).
4s default, 7s with action, max 2 stacked, swipe-up dismiss, `role="status"` (`alert` for errors).
`dev-inbox` variant: shows the 6-digit `devCode` in `font-mono tabular-nums` with a "Fill" action — dev only.

**Skeleton** — `bg-surface-2` block with shimmer; `rounded-sm` default. Primitives: `Skeleton` (w/h/`circle`),
`SkeletonText lines={n}` (last line 60%). Every slice builds its own *geometry-matching* skeletons from these
(`BuzzCardSkeleton`, `ListingCardSkeleton`…): same height, same radius, same padding as the real thing. Show
after 120ms of pending (avoid flash), minimum 300ms once shown. **No spinners** except inside a Button
(dots) and upload progress.

**EmptyState** — centred in the remaining space: 72px icon disc (`bg-accent-soft`, icon 28 `text-accent-ink`)
with two faint orbit rings behind it (1px `line`, 96px and 128px — the brand motif), title `type-title-2`
(max 2 lines), body `type-body text-ink-2` (max 3 lines, 280px wide), optional primary Button (md) + ghost link.
Copy is specific and campus-flavoured ("No one's selling a mini-fridge… yet"), never "No data".
```ts
interface EmptyStateProps { icon: LucideIcon; title: string; description?: string; action?: { label: string; onClick(): void }; secondary?: { label: string; onClick(): void }; compact?: boolean; }
```

**ErrorState** — same skeleton as EmptyState, `danger-soft` disc with `CloudOff`/`TriangleAlert`, title
"Couldn't load {thing}", description from `error.message` when user-safe, **Retry** secondary Button wired to
`refetch`. `inline` variant (single row with retry link) for failed pagination at the list bottom.

**InfiniteScroll sentinel** — `<InfiniteSentinel onReach hasMore isFetching error onRetry rootRef />`: a 1px
div observed with `rootMargin: '600px 0px'` against the screen's scroll container. Renders below the list:
fetching → 2–3 slice skeleton rows (passed as `skeleton` prop); error → inline ErrorState; `!hasMore` and list
non-empty → end cap: a tiny orbit glyph + "You're all caught up" `type-caption text-ink-3`, 32px vertical margin.

**PullToRefresh** (optional, touch only) — wrap a scroll container; when `scrollTop === 0` and dragging down,
content translates with 0.5 resistance, an orbit-ring glyph above rotates with pull distance; threshold 64px →
release triggers `onRefresh` (ring spins until resolved, min 500ms), then `settle` back. Disabled on the Reels
pane and under reduced motion (replaced by a header refresh action).

### 5.7 Shared composites (foundation `client/src/components/*`)

Not primitives, but shared so slices look identical: `Wordmark`, `FollowButton`, `UserRow` (Avatar + name +
@handle + campus + FollowButton), `MediaImage` (aspect-ratio box, blur-up from dominant colour, error
fallback glyph), `ReportSheet` (reason radio list → optional details → submitted state; works in both surface
modes), `BlockDialog`, `OverflowMenu` (ActionSheet preset: Share, Save, Report, Block), `ComposerModeBanner`
(public: Avatar sm + "Posting as @handle"; incognito: mask glyph + overline "YOU'RE ANONYMOUS" on
`bg-hero-soft`), `CountLabel` (compact number format 1.2K), `TimeAgo`, `Screen` (scroll container with safe
areas + nav clearance, section 6.2), `SectionHeader` (title-3 + optional "See all" link).

---

## 6. App shell — `client/src/app/*`

### 6.1 Phone frame

```
<body class="bg-void">                       never scrolls (overflow hidden, height 100dvh)
  <AuroraBackdrop/>                          ≥768px only, fixed, aria-hidden
  <div id="frame">                           the app
    <div id="screen-root"> routes </div>
    <BottomNav/>
    <div id="overlay-root"/>                 Sheet / Dialog / Toast portals (absolute inset-0, pointer-events none until used)
  </div>
</body>
```

- **< 768px:** `#frame` = `fixed inset-0`, `bg-canvas`, no radius, no border.
- **≥ 768px:** `#frame` centred, `width: 430px`, `height: min(932px, 100dvh − 48px)`, `rounded-3xl`,
  `shadow-frame`, `overflow: hidden`, `isolation: isolate`, `contain: layout paint`. To the left of the frame
  (≥1100px only) a quiet brand block: Wordmark `type-display`, one line of copy, "Best on your phone" caption.
  Nothing else lives outside the frame.
- `#frame` is `position: relative`; **everything "fixed" in the app is `position: absolute` inside the frame**
  (nav, FAB, top bar, overlays). Do not use `position: fixed` or `100vw/100vh` in slices — use `100%`,
  `cqw`/`cqh` (`#frame` sets `container-type: size; container-name: frame`).
- **AuroraBackdrop:** `bg-void` + three blurred blobs (`filter: blur(120px)`, 38–45% opacity): violet
  `#8b5cff` at 18%/12%, cyan `#22d3ee` at 86%/28%, orchid `#c04dff` at 52%/104%, each ~46vmax; plus a 2%
  noise-free radial vignette. Drift per 4.2. Static under reduced motion.

### 6.2 Safe areas and the `Screen` primitive

```css
:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --topbar-h: 52px;
  --nav-h: 64px;
  --nav-gap: 12px;                                                        /* nav floats 12px above the bottom edge */
  --nav-clearance: calc(var(--nav-h) + var(--nav-gap) * 2 + var(--safe-bottom));   /* bottom padding for scroll content */
}
@media (min-width: 768px) { :root { --safe-top: 10px; --safe-bottom: 6px; } }   /* frame corners need breathing room */
```
`index.html` viewport: `width=device-width, initial-scale=1, viewport-fit=cover`. `theme-color` `#090b14`.

`<Screen>` is the one scroll container per route: `absolute inset-0 overflow-y-auto overscroll-y-contain
bg-canvas`, `padding-top: var(--safe-top)` (unless `bleed`), `padding-bottom: var(--nav-clearance)` when the
nav is visible, else `calc(16px + var(--safe-bottom))`. Scrollbars hidden (`scrollbar-width: none`). Props:
`nav?: boolean`, `bleed?: boolean`, `header?: ReactNode`, `footer?: ReactNode` (sticky bottom bar, e.g. chat
composer, listing CTA — gets safe-bottom padding and sits where the nav would be), `scrollRef`.

**Nav visibility:** visible on the six root tabs, Campus hub, Notifications, own Profile. Hidden on onboarding,
any screen with a bottom input/CTA bar (chat thread, Buzz thread, post detail, listing detail, roommate detail,
event detail), all composers/editors, Settings sub-pages and Admin. The nav slides out `y: 96` (`smooth`)
when hidden.

### 6.3 Bottom navigation (floating, 6 items, active expands)

Order and glyphs (lucide): **Home** `House` · **Discover** `Search` · **Messages** `MessageCircle` ·
**Roommates** `BedDouble` · **Market** `Store` (page title stays "Marketplace") · **Apartments** `Building2`.

- Container: `absolute`, `left/right: 8px`, `bottom: calc(var(--nav-gap) + var(--safe-bottom))`, height 64,
  `rounded-full glass`, inner padding 4px, `display:flex; justify-content: space-between; align-items:center`,
  `z-(--z-nav)`. `<nav aria-label="Primary">` with six `<NavLink>`s, `aria-current="page"`.
- **Inactive item:** 44×56 hit box, icon 22px stroke 1.75 `text-ink-3`; pressed `text-ink`. Label is
  visually hidden but present for screen readers.
- **Active item:** pill `h-12 pl-3 pr-3.5 rounded-full bg-accent-soft`, icon 22px stroke 2.25 `text-ink`,
  6px gap, label `type-caption font-semibold text-ink` (12px; drops to 11px when `@container frame (width < 372px)`).
  Pill `min-width: 96px; max-width: 132px`. Widest case ("Apartments") = 116px, which is exactly the free space at a
  360px frame: 360 − 16 (margins) − 8 (padding) − 5×44 = 116. Do not add gaps or a 7th item.
- Animation: each item is `motion.div layout`; the pill background is a shared `layoutId="nav-pill"` element
  (`snappy`); label mounts with opacity 0→1 (150ms, 40ms delay) and unmounts instantly. Reduced motion: no
  layout animation, instant swap.
- Badges: Messages shows `Badge count` (top-right of icon, 2px `canvas` stroke); Apartments shows a `dot`
  until first visit. Notifications are *not* in the nav (bell lives in the Home top bar).
- Surface awareness: while the Home pager rests on **Reels**, nav glass darkens to `bg-black/45` and
  `accent-soft` becomes `white/14` (neutral over video). While on **Buzz**, the nav container gets
  `data-surface="incognito"` so the Home pill turns Phosphor. Both are driven by the same pager progress value
  (crossfade of two stacked background layers; do not animate the colour variables themselves).
- Re-tapping the active item scrolls its screen to top (Home: active pane to top / first reel).

### 6.4 Home top bar (overlays the feed)

`absolute top-0 inset-x-0 z-(--z-topbar)`, height `calc(var(--topbar-h) + var(--safe-top))`, `px-2`, three columns:

| Left (44) | Centre | Right (44) |
|---|---|---|
| `Avatar sm ring="orbit"` of the viewer → opens the **Me sheet** (profile, Campus hub, saved, settings, guidelines, admin if role) | tablist **Reels · Buzz · Orbit** | `IconButton` `Bell` with count badge → Notifications |

- Tab labels: Sora 600 16px, `gap-5`, each a `<button role="tab">` with 44px height. Colour is scroll-linked:
  the label nearest the pager position is `white` (Reels) / `ink` at 100%, others at 55% opacity.
- **Indicator:** a 20×3px `rounded-full` bar, 6px under the labels. Its `x` is
  `useTransform(scrollXProgress, [0, .5, 1], [c0, c1, c2])` where `c*` are measured label centres (ResizeObserver);
  its width stretches to 32px at the midpoints (`[0,.25,.5,.75,1] → [20,32,20,32,20]`) for a liquid feel; its
  colour interpolates `#ffffff → #c5f53b → #7c5cff`. Driven by `useScroll({ container: pagerRef, axis: 'x' })`
  — **no spring, no state**: it is glued to the finger.
- **Background layers** (stacked, opacity scroll-linked): (a) `bg-scrim-top`, 120px tall, opacity `1 → 0` from
  Reels to Buzz; (b) glass bar, opacity `0 → 1` from Reels to Buzz, staying 1 through Orbit; layer (b) carries
  `data-surface="incognito"` tint crossfading to the public tint between Buzz and Orbit (two stacked glass
  layers, opacity swapped). Over Reels, icons and labels are pure white with a 1px text shadow `rgb(0 0 0/.4)`.
- A tiny `VenetianMask` 12px glyph sits before the "Buzz" label, in `incog-500` at 0→1 opacity as Buzz becomes
  active: the permanent reminder that this pane is anonymous.
- The bar never hides on scroll (tabs must stay reachable); Buzz/Orbit panes pad their content by its height.

### 6.5 Horizontal pager + nested vertical reels snap

Pure CSS scroll-snap; motion only *reads* scroll. No drag gesture libraries, no transforms on panes.

```tsx
<div ref={pagerRef} role="presentation"
  className="absolute inset-0 flex overflow-x-auto overflow-y-hidden snap-x snap-mandatory overscroll-x-contain [scrollbar-width:none]">
  <section aria-label="Reels" className="relative h-full w-full flex-none snap-start snap-always"> <ReelsPane active={i===0}/> </section>
  <section aria-label="Buzz"  className="relative h-full w-full flex-none snap-start snap-always"> <Surface mode="incognito" className="h-full"><BuzzPane active={i===1}/></Surface> </section>
  <section aria-label="Orbit" className="relative h-full w-full flex-none snap-start snap-always"> <OrbitPane active={i===2}/> </section>
</div>
```

- **Axis locking is native:** the pager scrolls only X; each pane owns a Y scroller. Browsers lock a touch
  gesture to the first dominant axis, so diagonal swipes do not fight. Do not set `touch-action: none`
  anywhere inside Home.
- **Reels pane Y scroller:** `h-full overflow-y-auto snap-y snap-mandatory overscroll-y-contain`; each reel is
  `h-full w-full snap-start snap-always relative` (one reel per fling — `snap-always` is mandatory). The pane
  is full-bleed: video runs under the top bar and under the nav; overlays respect
  `bottom: var(--nav-clearance)`.
- **Buzz / Orbit panes:** plain `overflow-y-auto overscroll-y-contain`, `padding-top: calc(var(--topbar-h) +
  var(--safe-top) + 8px)`, `padding-bottom: var(--nav-clearance)`. No Y snap.
- **Horizontal children inside panes** (chip rows, `FollowingReelsRail`, image carousels) must set
  `overscroll-behavior-x: contain` and `touch-action: pan-x pan-y` so reaching their edge does not yank the pager.
- **Active pane index:** derived from scroll, never the source of truth for it: on `scrollend` (fallback: 80ms
  debounce of `scroll`) compute `Math.round(scrollLeft / clientWidth)`, store in zustand `home.activeTab`, and
  `navigate(..., { replace: true })` to keep the URL in sync. Tab tap → `pager.scrollTo({ left: i * clientWidth,
  behavior: reduced ? 'auto' : 'smooth' })`. On mount, jump to the URL's tab with `behavior: 'auto'` before paint
  (`useLayoutEffect`).
- **Keep all three panes mounted** (scroll positions persist). Panes receive `active`; inactive panes pause
  videos, stop polling, and defer their first query until `progress` comes within 0.15 of them.
- **Reel activation:** `IntersectionObserver` (root = Y scroller, threshold 0.6) sets `activeReelId`. Only
  reels at index `active−1…active+1` mount a `<video>` (`playsInline muted loop preload="metadata"`,
  `object-cover`); the rest render their poster only. Active + pane active + document visible → `play()`,
  otherwise `pause()`. `onError`/missing file → **animated poster fallback** (seed SVG art with Ken Burns +
  faux progress), identical overlays, no error UI.
- **Reel overlay layout:** top scrim (shared with top bar), bottom scrim 45% height. Bottom-left
  (`left-4 right-20`): Avatar md + `@handle` `type-headline` + FollowButton sm, caption `type-body` 2-line clamp
  ("more" expands in place), campus/audio pill. Right rail (`right-2`, centred on the lower third, gap 16):
  like, comment, share, save, more — `IconButton lg variant="ghost"` white icons 28px with `type-caption`
  counts beneath and a soft drop shadow. 2px progress bar pinned at `bottom: var(--nav-clearance) − 8px`.
  Tap = pause/play (big glyph fades 400ms), double-tap = like burst at the touch point. Long-press is reserved (does nothing).
- Keyboard (desktop frame): ←/→ switch panes, ↑/↓ or J/K move reels, Space toggles play, M mutes.

---

## 7. Per-screen layout notes

Family rules that apply to every screen below: one `<Screen>`; `PageHeader` (large on root tabs, compact on
pushed screens); 16px gutters; sticky filter row lives in `PageHeader.below`; one FAB or one bottom CTA bar,
never both; lists = skeleton → content → `InfiniteSentinel`; overflow (`Ellipsis`) on every UGC item opens
`OverflowMenu` with Report (+ Block on public surfaces).

### 7.1 Auth & onboarding (`auth`) — nav hidden, public surface

- **Welcome.** Full-bleed canvas with an in-frame aurora (two blurred blobs at 30% opacity behind a slowly
  rotating 3-ring orbit illustration, SVG, top 55%). Wordmark `type-display`, one-line promise `type-body-lg
  text-ink-2`, then a bottom-anchored stack: `hero` Button lg "Continue with university email", caption
  "Only verified students and campus orgs" with `GraduationCap`. Nothing else.
- **Email.** Compact header with back + `StepDots` (5). Title `type-display` "What's your uni email?", Input lg
  (`type="email"`, `inputMode="email"`, autoFocus, leftIcon `Mail`). On a recognised domain, a `CampusBadge`
  row fades in beneath ("Stanford University") — instant reward. Personal-provider rejection is a friendly
  inline error, not a toast. CTA pinned above the keyboard.
- **Code.** Title "Check your inbox", subtitle with the masked email, `OTPInput` centred, resend link with a
  30s countdown (`tabular-nums`), attempts error inline. Dev: `dev-inbox` toast with "Fill".
- **Profile.** Avatar 2xl with camera IconButton overlay (DiceBear shuffle + upload), Inputs: name, @handle
  (prefix `@`, live availability tick), Select: major, class year; account type SegmentedControl Student/Org.
- **Guidelines.** Four icon rows (Be kind · No harassment or threats · Nothing illegal · Anonymous ≠
  unaccountable) on a `hero` Card; a required Switch row "I agree to the Community Guidelines"; link to the full page.
- **Follow suggestions.** `UserRow` list grouped by `SectionHeader` (From your campus · Popular orgs), "Follow
  all" ghost action, CTA "Enter UniVerse" (`hero`) enabled at any time; sub-caption "Follow 3+ to fill your Orbit".

### 7.2 Home (`reels`, `buzz`, `orbit`) — shell in 6.4/6.5

- **Reels pane.** As 6.5. Skeleton = full-bleed `surface-1` with shimmer + ghost rail. Empty = EmptyState on
  canvas with "Post the first reel" CTA. Comments open a `['half','full']` Sheet (rows: Avatar sm, name,
  `type-body`, like) with a glass composer footer "Posting as @handle". Share/More = ActionSheet.
- **Reel upload.** Compact header "New reel". 9:16 preview card (`rounded-lg`, max 60% height), `RangeSlider`
  trim with a hard 60s cap and a `danger` caption if exceeded, caption Textarea (bare, 150 chars),
  `ComposerModeBanner` public, scope SegmentedControl Campus/Global, bottom CTA bar with `ProgressBar` on upload.
- **Buzz pane (incognito).** Under the top bar: sticky row with SegmentedControl sm Hot/New/Top (left) and a
  Campus/Global Chip toggle (right). Feed of **BuzzCards**: `surface-1` cards, `rounded-lg`, 12px apart, 16px
  gutter; header `AliasAvatar sm` + alias label + `OpBadge` + `TimeAgo`; text `type-body` (6-line clamp); optional
  poll (rows = `surface-2` bars filling `accent-soft`, percentage `tabular-nums`); footer: vote cluster
  (`ArrowBigUp` · score · `ArrowBigDown` in a `surface-2` pill), replies count, share, overflow. Auto-hidden
  buzzes collapse to a one-line "Hidden by community score · Show" row. FAB = compose. First visit shows the
  **Guidelines gate**: a non-dismissible `full` Sheet (incognito) with the mask glyph, 4 rules, "Anonymous to
  students, accountable to moderators" in `type-footnote`, and an "I understand" `primary` Button.
- **Buzz thread.** Incognito compact header "Thread" + overflow. Root buzz in `type-body-lg`, no card chrome;
  replies indented one level max with a 2px `line` rail, deeper replies flatten with "↳ replying to Anon Nova".
  `isMine` items show a soft "you" badge. Bottom glass reply bar: mask glyph + "Reply anonymously…" + send IconButton.
- **Buzz composer.** `full` Sheet, incognito. `ComposerModeBanner` incognito pinned on top, bare Textarea
  (`type-body-lg`, 500 chars counter), toolbar: poll toggle, scope chip, "Add to thread". CTA `hero`
  (Phosphor gradient, dark text) "Buzz it". No avatar, no handle, no camera roll identity hints anywhere.
- **Orbit pane (public).** Optional `FollowingReelsRail` on top (Avatars lg `ring="orbit"` + name caption,
  horizontal, contained overscroll), then **PostCards**: *not boxed* — full-width blocks separated by
  `line-subtle` dividers (contrast with boxed Buzz cards): header `UserRow`-lite (Avatar md, name
  `type-headline`, @handle · time `type-caption`), text `type-body`, media `MediaImage rounded-lg` (4:5, 1:1 or
  16:9; 2–4 images = 2-col mosaic, 2px gaps), poll, action row (like · comment · share · save) with counts.
  Empty = "Your orbit is quiet" + CTA to Discover. FAB = new post.
- **Post detail / composer.** Detail: compact header, post at `type-body-lg`, comments list, glass comment bar
  "Posting as @handle". Composer: `full` Sheet with public `ComposerModeBanner`, bare Textarea, image tray
  (72px thumbs, removable), poll builder, audience Select, CTA "Post".

### 7.3 Discover & profiles (`discover`)

- **Discover.** Large header "Discover"; `below` = search Input (rounded-full) that, on focus, pushes the
  search screen. Body sections with `SectionHeader`: a Campus hub `hero` Card (quick links grid: Events,
  Course chats, Marketplace, Roommates) · "People you may know" (horizontal 148px cards: Avatar lg, name, major,
  mutuals `type-caption`, FollowButton) · "Active creators" (UserRows) · "Popular orgs" (org-shaped avatars,
  VerifiedBadge) · "Trending on campus" (public posts only). **No Buzz content, no alias, no Phosphor here.**
- **Search.** Compact header is the search Input itself (autoFocus) + Cancel. Tabs: Top · People · Orgs.
  Recent searches (removable rows) before typing; results = `UserRow`s; debounce 250ms with row skeletons.
- **Profile.** Transparent compact header over a 120px `bg-hero-soft` cover band (generated mesh per user).
  Avatar xl overlapping the band by 40px (org shape for orgs), name `type-title-2` + VerifiedBadge, @handle,
  CampusBadge + major · year, bio `type-body`, stats row (Posts · Followers · Following, `tabular-nums`, tappable),
  actions: FollowButton md + Message `secondary` + overflow (Report/Block). Sticky Tabs: Posts
  (`UserPostsList`) · Reels (`UserReelsGrid`, 3-col 9:16, 2px gaps, view count overlay) · About. Own profile
  swaps actions for "Edit profile" + Share. A profile never shows Buzz activity.
- **Follow lists / Edit profile.** Lists: compact header with Tabs Followers/Following, search field,
  `UserRow`s. Edit: Avatar 2xl with change overlay, Field stack, Save in header (disabled until dirty),
  discard Dialog on back.

### 7.4 Messages (`messages`)

- **Inbox.** Large header "Messages" + new-chat IconButton (`SquarePen`). `below`: search + Chips All · Unread ·
  Groups · Requests(count). Rows = `ListRow` with Avatar lg (`presence`), name, last message `type-footnote`
  1 line (typing → accent "typing…"), `meta` time, unread count Badge. Course/group chats use AvatarStack.
  Requests appear as a pinned `raised` Card row on top.
- **Chat thread.** Compact header: Avatar sm + name + presence/"3 members" subtitle; trailing info button. Nav
  hidden. Bubbles max-width 78%: mine `bg-accent text-on-accent`, theirs `bg-surface-2 text-ink`; radius 20 with
  6px tail corner; 2px between same-sender bubbles, 12px between groups; centred day separators
  `type-caption text-ink-3`; read receipts `CheckCheck` 14px under last own bubble; typing = 3 dots bubble.
  Images `rounded-lg` max 240px. **Context cards** (listing / roommate) render as a `raised` Card with
  thumbnail, title, price/compat and "View" — pinned above the first message. Footer: glass composer — attach
  IconButton, auto-growing Textarea (`rounded-[22px]`, 1–5 rows), send `IconButton accent` appearing when non-empty.
- **Requests / New chat / Group info.** Requests: preview thread with a bottom bar Accept (`primary`) · Delete
  (`ghost`) · Block (`danger-ghost`). New chat: search + selectable UserRows (checkbox trailing), selected
  people as removable Chips, CTA "Start chat". Group info: AvatarStack hero, name, members list, mute Switch,
  Leave (`danger-ghost`).

### 7.5 Roommates (`roommates`)

- **Browse.** Large header "Roommates"; `below`: SegmentedControl Browse / My listing + filter IconButton with
  active-filter count Badge. Active filters echo as removable Chips. Cards are full-width `media` Cards: 4:5
  photo/art with bottom scrim, name + age/year `type-title-3`, CampusBadge, budget `font-display tabular-nums`
  + move-in date, 3 lifestyle `tag` Chips, and a **`ProgressRing` 64 compatibility %** floating top-right on a
  glass disc (ring counts up with `gentle`; ≥85% gets the one allowed `bouncy` pop). Save = bookmark IconButton glass.
- **Filters.** `['full']` Sheet: RangeSlider budget, Select move-in, ChipGroups (sleep, cleanliness, guests,
  pets, smoking), Switch "Same campus only", sticky footer "Show 24 matches" (`primary`) + Reset (`ghost`).
- **Detail.** Hero image 4:5 under a transparent header, overlapping sheet-like body (`rounded-t-xl
  bg-canvas`, −24px): name, compat ring 96 with "Why you match" breakdown (three `ProgressBar` rows),
  about text, lifestyle grid (icon + label cells, 2 col), bottom CTA bar: Message (`primary`, opens chat with a
  roommate context card) + Save.
- **My listing / questionnaire.** One question per step: `StepDots`, `type-title-1` question, large `choice`
  Chips or Slider, "Next" bottom CTA; `gentle` crossfade between steps; final review screen as grouped
  ListRows with edit chevrons and a "Publish" `hero` Button; published state shows a status Card (Active ·
  Paused Switch).

### 7.6 Marketplace (`market`)

- **Browse.** Large header "Marketplace" + saved (`Bookmark`) and my-listings (`Package`) IconButtons; `below`:
  search Input + horizontally scrolling category Chips (All, Textbooks, Furniture, Electronics, Clothing,
  Tickets, Free…) + type SegmentedControl sm (Sell · Trade · Free · Wanted) revealed by the filter button.
  **2-col grid**, 12px gap: `ListingCard` = 1:1 `MediaImage rounded-lg`, price `type-headline font-display
  tabular-nums` (Free = gold soft Badge, Trade = info soft Badge, Wanted = outline Badge), title `type-footnote`
  1-line, campus · time `type-caption text-ink-3`, save heart glass top-right. Sold = 50% dim + "Sold" Badge.
  FAB extended "Sell".
- **Listing detail.** Swipeable 4:3 gallery (snap-x, dots, contained overscroll) under a transparent header;
  price `type-title-1 font-display`, title `type-title-3`, condition/category tag Chips, description, seller
  `UserRow` (real profile — public surface) with "Member since", a collapsible **Safety tips** Card
  (`warning-soft`, `ShieldCheck`), bottom CTA bar: "Message seller" `primary` + "Make offer" `secondary`
  (offer = Sheet with price Input → sends a message with listing context card).
- **Create / edit listing.** Compact header "New listing"; photo tray first (add tile 88px dashed `line-strong`,
  drag-reorder optional, first = cover), then Fields: title, price (prefix `$`, hidden for Free/Wanted), type
  SegmentedControl, category Select, condition ChipGroup, description Textarea, public `ComposerModeBanner`
  ("Listing as @handle"), CTA "Publish".
- **My listings / Saved.** Tabs Active · Sold (My) — rows with 56px thumb, title, price, views; trailing
  overflow (Edit, Mark sold, Delete → danger Dialog). Saved reuses the grid.

### 7.7 Apartments (`apartments`)

- **Coming soon.** Nav visible, no PageHeader — a single composed poster: in-frame aurora glow behind an
  isometric SVG skyline with orbit rings (top 45%), overline "APARTMENTS", `type-display` "Coming soon" with
  `text-hero` on the second word, `type-body-lg text-ink-2` pitch, three feature rows (icon disc + one line:
  verified listings · sublets · lease takeovers), then the **`hero` Button lg "Get notified"**. On tap:
  optimistic morph to a success state — button becomes `secondary` with `Check` "You're on the list"
  (`bouncy` tick, once), waitlist position/count `type-caption tabular-nums`, and a **micro-survey Card**
  slides in (`fadeUp`): one question at a time with `choice` Chips (budget, bedrooms, move-in term), StepDots,
  skippable. All taps are tracked by the slice; visually nothing signals tracking beyond a `type-caption`
  privacy line.

### 7.8 Campus hub (`campus`)

- **Hub.** Large header = university name with CampusBadge. Quick-links grid 2×3 (`interactive` Cards: icon
  disc + label → Events, Course chats, Marketplace, Roommates, Buzz, Guidelines), "This week" events carousel
  (280px `media` Cards 16:9 with date tile), "Your course chats" rows.
- **Events list / detail.** List: date-grouped (sticky `type-overline` day headers) `media` Cards with a
  48px date tile (month overline + day `type-title-2`), title, host org row, going AvatarStack. Detail: 16:9
  cover, title `type-title-2`, when/where ListRows (`CalendarDays`, `MapPin`), host `UserRow` (org avatar),
  description, attendees, bottom CTA bar RSVP SegmentedControl-like pair: Going (`primary`) · Interested
  (`secondary`); Going state shows `Check` with one `bouncy` tick.
- **Course chats directory.** Search + department Chips; rows: course code tile (48px `surface-3 rounded-sm`,
  `font-display` code), title, member count, trailing Join `Button sm` ↔ "Open". Joining pushes the group chat.

### 7.9 Notifications & Settings (`apartments` slice)

- **Notifications.** Compact header + "Mark all read". Grouped by Today · This week · Earlier
  (`type-overline`). Rows = `ListRow`: public events lead with the actor's Avatar md + a 16px type glyph badge;
  **Buzz-origin rows lead with a 40px incognito disc (`VenetianMask`, Phosphor on `incog-surface-2`) and copy
  that never names anyone** ("Someone replied to your buzz"). Unread = `surface-1` tint + accent dot.
- **Settings.** Compact header. Grouped Cards of `ListRow`s with `type-overline` group labels: Account
  (email — read-only with verified tick, handle), Privacy (who can message me Select, blocked users),
  Notifications (Switch rows), Appearance (reduced motion Switch, data saver/autoplay Switch), About
  (Guidelines, version `font-mono type-caption`), and a final `danger-ghost` "Log out" + "Delete account"
  (danger Dialog). Sub-pages push; nav hidden on sub-pages.

### 7.10 Trust & Safety (`admin`)

- **Admin shell.** Public surface but deliberately utilitarian: compact header "Trust & Safety" with role
  Badge, scrollable Tabs: Queue · Reports · Flagged · Users · Audit · Analytics. Denser type (`type-footnote`
  bodies), no hero gradients, no `bouncy`.
- **Queue / Reports.** Cards with a left 3px severity rail (`info`/`warning`/`danger`), content excerpt in a
  quoted `surface-2` block (Buzz excerpts render inside a nested `Surface incognito` chip-frame with the alias
  only), reason Badges, report count, age; actions row: Dismiss (`ghost`) · Hide (`secondary`) · Remove
  (`danger`) · Sanction (opens ladder Sheet: Warn → Mute 24h → Suspend 7d → Ban, radio list with consequences).
- **Unmask.** Visible to `admin` only, `danger-ghost` with `Eye` icon → `persistent` danger Dialog: warning copy,
  required reason Textarea (min 20 chars, counter), confirm label "Unmask and log". Result shows in a
  `warning-soft` Card with the audit id in `font-mono`. Moderators never see this control.
- **Audit log / Analytics.** Audit: monospace-timestamp rows, actor, action Badge, target, expandable reason.
  Analytics: stat tiles (2-col, value `type-title-1 tabular-nums`, delta Badge), Apartments engagement **funnel**
  (horizontal bars: Views → Get-notified taps → Survey started → Survey completed, `bg-hero` fills on
  `surface-2` tracks, percentages right-aligned), simple SVG sparkline per tile; no chart library.
- **Community Guidelines page.** Reading layout: compact header, `type-title-1` title, last-updated caption,
  numbered sections with icon discs, prose `type-body-lg` at `text-ink-2`, do/don't pairs in
  `success-soft`/`danger-soft` Cards, closing "Report a problem" `secondary` Button. Same page in both
  onboarding link and Buzz gate link.

### 7.11 Global flows

- **Me sheet** (from Home avatar): `auto` Sheet — profile header row (Avatar lg, name, @handle, CampusBadge,
  chevron), then ListRows: Campus hub, Saved, Settings, Community Guidelines, Trust & Safety (role-gated).
- **Report.** `ReportSheet`: step 1 reasons (radio ListRows: Harassment or bullying, Threats or violence,
  Drugs or illegal sales, Hate, Sexual content, Spam or scam, Something else) → step 2 optional details
  Textarea → step 3 confirmation with `ShieldCheck` and "We review reports within 24 hours". Inherits the
  surface mode of where it was opened.
- **Block.** `BlockDialog` (danger tone): explains effects in one sentence; public surfaces only. In Buzz the
  equivalent is "Hide this thread" / "Mute this alias in this thread" — never "Block user".
- **Offline / API error.** Toast error for mutations (with Retry action); ErrorState for queries.
- **404 / no access.** EmptyState with `Orbit` icon, "Lost in space", Button back to Home.

---

## 8. Iconography, imagery, do / don't

### 8.1 Icons — `lucide-react` only

- Named imports only (`import { Heart } from 'lucide-react'`); never `import *`, never the dynamic icon
  loader, never another icon set, never emoji as UI icons (emoji are content: aliases, reactions, chat).
- Sizes: **16** inline with text · **18** in sm controls · **20** default · **22** bottom nav · **24** FAB and
  header actions over media · **28** reel rail and EmptyState. `strokeWidth` **1.75** default, **2** at 16px,
  **2.25** for the active nav icon. Always `aria-hidden` when next to a label; icon-only controls get
  `aria-label` via IconButton.
- Colour = `currentColor`. Fill is allowed for exactly four toggled states: `Heart` (love), `Bookmark` (accent-ink),
  `ArrowBigUp` / `ArrowBigDown` (accent-ink / incog-down), `Bell` when unread is *not* filled (use the badge).
- Canonical glyphs (use these, do not improvise synonyms; if a name fails typecheck in the installed version
  use the noted alias):

| Meaning | Icon | Meaning | Icon |
|---|---|---|---|
| Home / Discover / Messages | `House` (alias `Home`) / `Search` / `MessageCircle` | Roommates / Market / Apartments | `BedDouble` / `Store` / `Building2` |
| Reels / Buzz / Orbit | `Clapperboard` / `VenetianMask` / `Orbit` | Campus / Events / Courses | `GraduationCap` / `CalendarDays` / `BookOpen` |
| Notifications / Settings | `Bell` / `Settings` | Create / Compose | `Plus` / `SquarePen` |
| Like / Comment / Share / Save | `Heart` / `MessageCircle` / `Send` / `Bookmark` | Upvote / Downvote | `ArrowBigUp` / `ArrowBigDown` |
| Overflow / Close / Back | `Ellipsis` (alias `MoreHorizontal`) / `X` / `ChevronLeft` | Filter / Sort | `SlidersHorizontal` / `ArrowUpDown` |
| Report / Block / Hide | `Flag` / `Ban` / `EyeOff` | Safety / Verified | `ShieldCheck` / `BadgeCheck` |
| Camera / Image / Attach | `Camera` / `Image` / `Paperclip` | Play / Pause / Mute | `Play` / `Pause` / `Volume2` · `VolumeX` |
| Location / Price / Time | `MapPin` / `Tag` / `Clock` | Sent / Read | `Check` / `CheckCheck` |
| Error / Offline / Warning | `CircleAlert` / `CloudOff` / `TriangleAlert` | Unmask (admin) / Audit | `Eye` / `ScrollText` |

`VenetianMask` is **the** incognito signifier and appears only on Buzz UI (and Buzz-origin notification rows).

### 8.2 Imagery — locally generated seed art (no network, ever)

- **Avatars (students):** DiceBear `notionists` (fallback `lorelei`) seeded by user id, background from a fixed
  8-colour set of deep tints (`#1f2547 #2a1f47 #0f3340 #12382c #3d2a14 #40202c #25304a #33204a`) so faces sit
  calmly on dark UI. **Orgs:** DiceBear `shapes` or `initials` on the same tints, rendered in the org
  rounded-square. **Anonymous aliases never use DiceBear** — emoji + alias colour only.
- **Reel posters / fallback art (9:16):** SVG "nebula" compositions: `canvas` base, 2–3 large blurred radial
  gradients from the aurora stops (violet, azure, cyan, mint, orchid) at varied positions, a thin orbit ellipse
  or two (1px white 12%), 20–40 tiny stars (white 30–70%), and a short Sora title lower-left. Twelve
  variations keyed to `reel-01…12`. No faces, no stock-photo imitation, no text smaller than 28px in art.
- **Post / event images:** same nebula language plus a single large flat glyph (lucide path, white 85%) that hints
  at the topic (music note, trophy, pizza). Aspect 4:5, 1:1 or 16:9 only.
- **Marketplace items:** flat "product tile" SVGs, 1:1: `surface-2` to category-tint vertical gradient, one
  centred category illustration built from simple geometry (book, lamp, bike, chair, laptop, hoodie, ticket),
  soft ground shadow ellipse. Category tints: textbooks azure, furniture amber, electronics cyan, clothing
  orchid, tickets mint, free gold. Never Phosphor lime.
- **Roommate cards:** the user's avatar art scaled up on its tint with a nebula wash; 4:5.
- **Profile covers:** `bg-hero-soft`-style mesh seeded by user id (hue-shifted within violet→cyan only).
- **Technical rules:** every image sits in `MediaImage` with a fixed `aspect-ratio`, `object-cover`,
  `bg-surface-2` placeholder, `loading="lazy"`, `decoding="async"`, explicit `alt` (UGC: caption-derived or
  "Photo by @handle"; decorative: `alt=""`). SVG seed files ≤ 12KB each, no embedded rasters, no external
  fonts inside SVG (convert titles to system `font-family` stack with Sora first). Uploaded user photos are
  shown as-is; never apply filters or tints to UGC.

### 8.3 Do

- Do read accent/canvas/surface **slots**; let `Surface` decide the world.
- Do use `type-*` roles, the spacing steps in 3.1, and kit components before writing any bespoke markup.
- Do reserve final geometry for async content (skeletons, aspect-ratio boxes, locked button widths).
- Do make state changes optimistic with a rollback Toast on failure.
- Do keep one primary action per screen and put it where the thumb is (bottom CTA bar or FAB).
- Do write specific, human, campus-flavoured copy for empty/error/success states. Sentence case everywhere;
  the only uppercase is `type-overline`.
- Do show identity mode in every composer via `ComposerModeBanner`.
- Do test each screen at 360×640, 390×844, 430×932 and in the desktop frame, with reduced motion on.

### 8.4 Don't

- Don't use raw hex, default Tailwind colours, arbitrary font sizes, arbitrary radii, or z-index numbers.
- Don't use violet/aurora, `Avatar`, `@handle`, or "Block user" inside Buzz; don't use Phosphor, `AliasAvatar`
  or `VenetianMask` outside it. Don't ever place a real avatar and an alias in the same card.
- Don't use glass on scrolling content, shadows on in-list cards, or more than one `hero` gradient per screen.
- Don't use spinners (skeletons instead), native `alert/confirm`, native `<select>` popups, or browser
  scrollbars.
- Don't use `position: fixed`, `100vh/100vw`, or body scroll — the phone frame breaks.
- Don't animate layout properties, loop decorative animations, or use `bouncy` outside celebrations.
- Don't centre-align body text longer than three lines; don't use pure `#000` backgrounds or pure white
  large fills (the brightest fill is a Phosphor or accent button).
- Don't ship a control that does nothing. If a feature is out of scope, remove the control.
- Don't put text over media without a scrim; don't put more than two lines of text on a Button.
- Don't introduce a new component variant in a slice — compose existing ones, or report the gap.

---

## 9. Appendix — global base styles (foundation, `client/src/app/styles/base.css`)

```css
@layer base {
  html, body, #root { height: 100%; }
  html { color-scheme: dark; -webkit-text-size-adjust: 100%; }
  body {
    margin: 0; overflow: hidden; background: var(--color-void); color: var(--color-ink);
    font-family: var(--font-sans); font-size: 0.9375rem; line-height: 1.375rem; letter-spacing: -0.005em;
    font-feature-settings: "cv11", "ss01"; font-optical-sizing: auto;
    -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    -webkit-tap-highlight-color: transparent; text-rendering: optimizeLegibility;
  }
  button, a, [role="button"] { touch-action: manipulation; }
  :focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; border-radius: inherit; }
  ::selection { background: var(--color-accent-soft); color: var(--color-ink); }
  input, textarea, select { font-size: 1rem; }               /* iOS zoom guard */
  img, video, svg { display: block; max-width: 100%; }
  * { scrollbar-width: none; } *::-webkit-scrollbar { display: none; }
}
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@utility skeleton {
  background-color: var(--color-surface-2);
  background-image: linear-gradient(100deg, transparent 30%, rgb(255 255 255 / .07) 50%, transparent 70%);
  background-size: 200% 100%; animation: shimmer 1.4s linear infinite;
}
```

PWA manifest colours: `background_color` `#04050a`, `theme_color` `#090b14`; app icon = white orbit ring +
dot on the aurora gradient, maskable safe zone 80%.

**Definition of done for any screen:** tokens only · type roles only · skeleton/empty/error/infinite states
present · 44px targets · focus rings visible · reduced-motion checked · correct surface mode · no dead controls.


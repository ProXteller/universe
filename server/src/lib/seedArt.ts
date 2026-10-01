/**
 * Locally generated seed art (SPEC §4.2.15, design §8.2). No network, no rasters, no external fonts; every file is a
 * small deterministic SVG (≤ 12 KB). Written under `server/seed-media/generated/` and served at `/seed-media/generated/…`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export const EVENT_COVER_PRESETS = ['academic', 'social', 'sports', 'career', 'arts', 'food', 'music', 'outdoors'] as const;
export type EventCoverPreset = (typeof EVENT_COVER_PRESETS)[number];

const CANVAS = '#090b14';
const SURFACE_2 = '#171b2b';
const AURORA = { violet: '#8b5cff', azure: '#5b7cff', cyan: '#22d3ee', mint: '#5eead4', orchid: '#c04dff' } as const;
const AURORA_LIST = Object.values(AURORA);
const FONT = "Sora, 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

/* ───────────────────────────── deterministic PRNG ───────────────────────────── */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ───────────────────────────── glyphs (24 × 24 stroke paths, lucide-like geometry) ───────────────────────────── */

const GLYPHS: Record<string, string> = {
  music: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  trophy: 'M8 21h8 M12 17v4 M7 4h10v5a5 5 0 0 1-10 0V4z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4',
  pizza: 'M12 3 3 20c6 2 12 2 18 0L12 3z M9 13h.01 M14 15h.01 M12 9h.01',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z M4 19a2 2 0 0 1 2-2h13',
  calendar: 'M4 6h16v14H4z M8 3v4 M16 3v4 M4 10h16',
  users: 'M16 20v-2a4 4 0 0 0-8 0v2 M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M21 20v-2a3 3 0 0 0-3-3 M3 20v-2a3 3 0 0 1 3-3',
  ball: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 8l4 3-1.5 4.5h-5L8 11l4-3z M12 3v5 M3.5 9.5 8 11 M20.5 9.5 16 11 M6.5 19l3-3.5 M17.5 19l-3-3.5',
  code: 'M8 7l-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8z M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M6 11a6 6 0 0 0 12 0 M12 17v4 M9 21h6',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8L12 3z',
  leaf: 'M5 19c0-9 5-14 15-14 0 10-5 15-14 14 M5 19c3-5 6-8 10-10',
  briefcase: 'M4 8h16v11H4z M9 8V5h6v3 M4 13h16',
  palette: 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-.5-1.5-.5-2.5S14.5 15 16 15h2a3 3 0 0 0 3-3c0-5-4-9-9-9z M7.5 12h.01 M9.5 8h.01 M14.5 7.5h.01',
  mountain: 'M3 20l6-11 4 7 2-3 6 7H3z',
  flask: 'M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3 M7.5 15h9',
  film: 'M4 4h16v16H4z M8 4v16 M16 4v16 M4 9h4 M4 15h4 M16 9h4 M16 15h4',
  bike: 'M6 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M18 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M6 15.5l4-7h5l3 7 M10 8.5 8.5 6H7 M15 8.5l1-2.5h2',
  coffee: 'M5 9h12v6a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5V9z M17 10h1.5a2.5 2.5 0 0 1 0 5H17 M8 3v3 M12 3v3',
  home: 'M4 11l8-7 8 7v9H4v-9z M10 20v-6h4v6',
  chat: 'M4 5h16v11H9l-5 4V5z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z',
};

const PRESET_GLYPH: Record<EventCoverPreset, string> = {
  academic: 'book', social: 'users', sports: 'trophy', career: 'briefcase', arts: 'palette', food: 'pizza', music: 'music', outdoors: 'mountain',
};

function glyphPath(glyph: string | undefined): string | null {
  if (!glyph) return null;
  if (GLYPHS[glyph]) return GLYPHS[glyph]!;
  // A raw 24×24 path is accepted too (strictly path-data characters only).
  return /^[MmLlHhVvCcSsQqTtAaZz0-9\s,.-]+$/.test(glyph) && /^[Mm]/.test(glyph.trim()) ? glyph.trim() : null;
}

/* ───────────────────────────── nebula ───────────────────────────── */

const ASPECTS = { '9:16': [720, 1280], '4:5': [960, 1200], '1:1': [960, 960], '16:9': [1280, 720] } as const;

function wrapTitle(title: string, maxChars: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/[\s.,;:!?-]+$/, '')}…`;
    return kept;
  }
  return lines;
}

/**
 * "Nebula" composition: canvas base, 2–3 large soft radial gradients from the aurora stops, one or two thin orbit
 * ellipses, 20–40 tiny stars, an optional large flat glyph and an optional short title lower-left (never < 28 px).
 */
export function nebulaSvg(o: { seed: string; title?: string; aspect: '9:16' | '4:5' | '1:1' | '16:9'; glyph?: string }): string {
  const [w, h] = ASPECTS[o.aspect] ?? ASPECTS['1:1'];
  const rnd = mulberry32(hashString(`nebula:${o.seed}`));
  const uid = hashString(o.seed).toString(36);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;

  const blobCount = 2 + Math.floor(rnd() * 2);
  const used = new Set<string>();
  const defs: string[] = [];
  const blobs: string[] = [];
  for (let i = 0; i < blobCount; i++) {
    let color = pick(AURORA_LIST);
    for (let guard = 0; used.has(color) && guard < 6; guard++) color = pick(AURORA_LIST);
    used.add(color);
    const cx = r1(w * (0.1 + rnd() * 0.8));
    const cy = r1(h * (0.08 + rnd() * 0.8));
    const r = r1(Math.max(w, h) * (0.38 + rnd() * 0.3));
    const op = r1(0.42 + rnd() * 0.3);
    defs.push(
      `<radialGradient id="g${uid}${i}" cx="${cx}" cy="${cy}" r="${r}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${color}" stop-opacity="${op}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
    );
    blobs.push(`<rect width="${w}" height="${h}" fill="url(#g${uid}${i})"/>`);
  }

  const orbits: string[] = [];
  const orbitCount = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < orbitCount; i++) {
    const cx = r1(w * (0.3 + rnd() * 0.4));
    const cy = r1(h * (0.3 + rnd() * 0.35));
    const rx = r1(w * (0.42 + rnd() * 0.3));
    const ry = r1(rx * (0.28 + rnd() * 0.22));
    const rot = Math.round(-35 + rnd() * 70);
    orbits.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.5"/>`);
  }

  const stars: string[] = [];
  const starCount = 20 + Math.floor(rnd() * 21);
  for (let i = 0; i < starCount; i++) {
    stars.push(`<circle cx="${r1(rnd() * w)}" cy="${r1(rnd() * h)}" r="${r1(0.8 + rnd() * 1.8)}" fill="#fff" fill-opacity="${r1(0.3 + rnd() * 0.4)}"/>`);
  }

  let glyph = '';
  const gp = glyphPath(o.glyph);
  if (gp) {
    const size = Math.min(w, h) * 0.34;
    const s = r1(size / 24);
    const gx = r1(w / 2 - size / 2);
    const gy = r1(h * (o.title ? 0.4 : 0.5) - size / 2);
    glyph = `<g transform="translate(${gx} ${gy}) scale(${s})" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${gp}"/></g>`;
  }

  let title = '';
  if (o.title && o.title.trim()) {
    const fontSize = Math.max(28, Math.round(w * (o.aspect === '16:9' ? 0.045 : 0.075)));
    const maxChars = Math.max(10, Math.floor((w * 0.84) / (fontSize * 0.56)));
    const lines = wrapTitle(o.title, maxChars, 3);
    const lineH = Math.round(fontSize * 1.18);
    const x = Math.round(w * 0.08);
    const bottom = Math.round(h * 0.9);
    const startY = bottom - (lines.length - 1) * lineH;
    title =
      `<rect y="${Math.round(h * 0.55)}" width="${w}" height="${Math.round(h * 0.45)}" fill="url(#s${uid})"/>` +
      `<text x="${x}" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="#fff" fill-opacity=".96">` +
      lines.map((l, i) => `<tspan x="${x}" y="${startY + i * lineH}">${esc(l)}</tspan>`).join('') +
      '</text>';
    defs.push(`<linearGradient id="s${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CANVAS}" stop-opacity="0"/><stop offset="1" stop-color="${CANVAS}" stop-opacity=".72"/></linearGradient>`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-hidden="true">` +
    `<defs>${defs.join('')}</defs><rect width="${w}" height="${h}" fill="${CANVAS}"/>${blobs.join('')}${orbits.join('')}${stars.join('')}${glyph}${title}</svg>`
  );
}

/* ───────────────────────────── marketplace product tiles ───────────────────────────── */

/** Category tints (design §8.2). Never Phosphor lime. */
const CATEGORY_TINT: Record<string, string> = {
  textbooks: '#5b7cff', books: '#5b7cff', furniture: '#f5a524', electronics: '#22d3ee', clothing: '#c04dff',
  tickets: '#5eead4', free: '#f5c451', bikes: '#5eead4', transport: '#5eead4', kitchen: '#f5a524', dorm: '#8b5cff',
  sports: '#22d3ee', other: '#8b5cff',
};

type Shape = (cx: number, cy: number, fg: string, accent: string, variant: number) => string;

const SHAPES: Record<string, Shape> = {
  book: (cx, cy, fg, accent, v) =>
    `<g transform="rotate(${v % 2 ? -6 : 5} ${cx} ${cy})"><rect x="${cx - 150}" y="${cy - 190}" width="300" height="380" rx="18" fill="${fg}"/><rect x="${cx - 150}" y="${cy - 190}" width="46" height="380" rx="14" fill="${accent}"/><rect x="${cx - 70}" y="${cy - 110}" width="170" height="22" rx="11" fill="${accent}" opacity=".85"/><rect x="${cx - 70}" y="${cy - 66}" width="120" height="16" rx="8" fill="${accent}" opacity=".5"/></g>`,
  lamp: (cx, cy, fg, accent) =>
    `<path d="M${cx - 120} ${cy - 40}l60-170h120l60 170z" fill="${accent}"/><rect x="${cx - 9}" y="${cy - 40}" width="18" height="200" fill="${fg}"/><rect x="${cx - 90}" y="${cy + 150}" width="180" height="26" rx="13" fill="${fg}"/>`,
  chair: (cx, cy, fg, accent) =>
    `<rect x="${cx - 110}" y="${cy - 200}" width="220" height="210" rx="28" fill="${accent}"/><rect x="${cx - 130}" y="${cy + 20}" width="260" height="50" rx="20" fill="${fg}"/><rect x="${cx - 118}" y="${cy + 70}" width="20" height="120" rx="8" fill="${fg}"/><rect x="${cx + 98}" y="${cy + 70}" width="20" height="120" rx="8" fill="${fg}"/>`,
  laptop: (cx, cy, fg, accent) =>
    `<rect x="${cx - 170}" y="${cy - 150}" width="340" height="220" rx="16" fill="${fg}"/><rect x="${cx - 150}" y="${cy - 130}" width="300" height="180" rx="8" fill="${accent}" opacity=".9"/><path d="M${cx - 220} ${cy + 80}h440l-30 40H${cx - 190}z" fill="${fg}"/>`,
  hoodie: (cx, cy, fg, accent) =>
    `<path d="M${cx - 90} ${cy - 170}q90-60 180 0l110 70-50 90-50-30v230H${cx - 110}V${cy - 40}l-50 30-50-90z" fill="${accent}"/><path d="M${cx - 50} ${cy - 160}q50 70 100 0" fill="none" stroke="${fg}" stroke-width="14" stroke-linecap="round"/><rect x="${cx - 60}" y="${cy + 60}" width="120" height="70" rx="18" fill="${fg}" opacity=".35"/>`,
  ticket: (cx, cy, fg, accent, v) =>
    `<g transform="rotate(${v % 2 ? 8 : -8} ${cx} ${cy})"><path d="M${cx - 200} ${cy - 100}h400v70a30 30 0 0 0 0 60v70H${cx - 200}v-70a30 30 0 0 0 0-60z" fill="${accent}"/><path d="M${cx + 90} ${cy - 100}v200" stroke="${fg}" stroke-width="6" stroke-dasharray="14 12"/><rect x="${cx - 150}" y="${cy - 40}" width="190" height="22" rx="11" fill="${fg}" opacity=".8"/><rect x="${cx - 150}" y="${cy + 6}" width="120" height="16" rx="8" fill="${fg}" opacity=".5"/></g>`,
  bike: (cx, cy, fg, accent) =>
    `<circle cx="${cx - 130}" cy="${cy + 70}" r="92" fill="none" stroke="${fg}" stroke-width="16"/><circle cx="${cx + 130}" cy="${cy + 70}" r="92" fill="none" stroke="${fg}" stroke-width="16"/><path d="M${cx - 130} ${cy + 70}l80-150h130l50 150M${cx - 50} ${cy - 80}l80 150 50-150" fill="none" stroke="${accent}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M${cx - 80} ${cy - 110}h60M${cx + 60} ${cy - 120}h50" stroke="${fg}" stroke-width="16" stroke-linecap="round"/>`,
  box: (cx, cy, fg, accent) =>
    `<path d="M${cx - 170} ${cy - 70}l170-80 170 80v190l-170 80-170-80z" fill="${accent}"/><path d="M${cx - 170} ${cy - 70}l170 80 170-80M${cx} ${cy + 10}v190" fill="none" stroke="${fg}" stroke-width="10" stroke-linejoin="round" opacity=".7"/>`,
  mug: (cx, cy, fg, accent) =>
    `<rect x="${cx - 120}" y="${cy - 120}" width="220" height="260" rx="30" fill="${accent}"/><path d="M${cx + 100} ${cy - 50}h40a50 50 0 0 1 0 120h-40" fill="none" stroke="${accent}" stroke-width="26"/><rect x="${cx - 80}" y="${cy - 70}" width="60" height="16" rx="8" fill="${fg}" opacity=".6"/>`,
};

const CATEGORY_SHAPES: Record<string, string[]> = {
  textbooks: ['book'], books: ['book'], furniture: ['chair', 'lamp'], electronics: ['laptop'], clothing: ['hoodie'],
  tickets: ['ticket'], bikes: ['bike'], transport: ['bike'], kitchen: ['mug'], dorm: ['lamp', 'mug'], free: ['box'],
  sports: ['bike'], other: ['box'],
};

/** Flat 1:1 "product tile": surface-2 → category-tint gradient, one centred illustration, soft ground shadow. */
export function productTileSvg(o: { category: string; variant: number }): string {
  const key = o.category.trim().toLowerCase();
  const tint = CATEGORY_TINT[key] ?? CATEGORY_TINT.other!;
  const shapes = CATEGORY_SHAPES[key] ?? CATEGORY_SHAPES.other!;
  const variant = Math.abs(Math.trunc(o.variant)) || 0;
  const shape = SHAPES[shapes[variant % shapes.length]!] ?? SHAPES.box!;
  const size = 960;
  const cx = size / 2;
  const cy = size / 2 - 10;
  const uid = `${key.replace(/[^a-z0-9]/g, '')}${variant}`;
  const tilt = ((variant * 37) % 9) - 4;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-hidden="true">` +
    `<defs><linearGradient id="t${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${SURFACE_2}"/><stop offset="1" stop-color="${tint}" stop-opacity=".55"/></linearGradient></defs>` +
    `<rect width="${size}" height="${size}" fill="${SURFACE_2}"/><rect width="${size}" height="${size}" fill="url(#t${uid})"/>` +
    `<circle cx="${r1(size * (0.2 + ((variant * 13) % 60) / 100))}" cy="${r1(size * 0.22)}" r="${150 + ((variant * 29) % 90)}" fill="${tint}" opacity=".12"/>` +
    `<ellipse cx="${cx}" cy="${cy + 270}" rx="250" ry="34" fill="#000" opacity=".28"/>` +
    `<g transform="rotate(${tilt} ${cx} ${cy})">${shape(cx, cy, '#eef1ff', tint, variant)}</g></svg>`
  );
}

/* ───────────────────────────── event covers ───────────────────────────── */

export function eventCoverSvg(preset: EventCoverPreset): string {
  return nebulaSvg({ seed: `event-cover:${preset}`, aspect: '16:9', glyph: PRESET_GLYPH[preset] });
}

/* ───────────────────────────── files ───────────────────────────── */

const generatedDir = (): string => path.join(config.seedMediaDir, 'generated');

/** Writes under `server/seed-media/generated/` and returns the public URL `/seed-media/generated/<relPath>`. */
export function writeSeedSvg(relPath: string, svg: string): string {
  const clean = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((p) => p === '..' || p === '')) throw new Error(`writeSeedSvg: bad path "${relPath}"`);
  const file = path.join(generatedDir(), clean);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, svg, 'utf8');
  return `/seed-media/generated/${clean}`;
}

export function eventCoverUrl(preset: EventCoverPreset): string {
  return `/seed-media/generated/event-covers/${preset}.svg`;
}

/** The 8 preset covers exist from boot on (index.ts + db/reset.ts call this); idempotent. */
export function ensureEventCovers(): void {
  for (const preset of EVENT_COVER_PRESETS) {
    const file = path.join(generatedDir(), 'event-covers', `${preset}.svg`);
    if (!fs.existsSync(file)) writeSeedSvg(`event-covers/${preset}.svg`, eventCoverSvg(preset));
  }
}

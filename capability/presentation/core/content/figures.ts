import type { ContentBlock } from '../../contract/records/input.js';
import type { MeasuredContent, Primitive } from '../../contract/records/visual.js';
import type { ResolvedStyle } from '../../contract/records/style.js';
import { mattedWidth, printMat, stageTones } from './media.js';

type FigureBlock = Extract<ContentBlock, { kind: 'figure' }>;
type FigureForm = FigureBlock['form'];
type MediaPrimitive = Extract<Primitive, { kind: 'media' }>;

/** Fixed drawing canvas; the emitted media primitive scales it like any admitted asset. */
const VIEW = { width: 240, height: 150 } as const;
/** Semantic levels map to liquid height fractions exactly once; authored DSL never carries raw numbers. */
type FigureLevel = 'low' | 'half' | 'full';
const LEVEL_FRACTION: Readonly<Record<FigureLevel, number>> = {
  low: 0.3,
  half: 0.55,
  full: 0.8,
};
/** Gauge needles rest at fixed angles per level; zero is straight up. */
const NEEDLE_ANGLE: Readonly<Record<FigureLevel, number>> = {
  low: -55,
  half: 0,
  full: 55,
};

/** Theme-derived figure palette; roles fall back to neutral inks when a theme omits them. */
interface Palette {
  readonly ink: string;
  readonly wash: string;
  readonly tint: string;
  readonly soft: string;
  readonly accent: string;
  readonly accentAlt: string;
  readonly success: string;
  readonly lit: string;
  readonly shade: string;
}

/** Artwork stroke weights live in one table; scaling the house style is a one-line change. */
const STROKE = { frame: 3.5, line: 4.5, detail: 2.5 } as const;
/** Chroma of every filled band lives in one table; pastel strength is a house-style decision, not per-form taste. */
const FILL = {
  strataSoft: 0.65,
  strataAlt: 0.7,
  strataInk: 0.85,
  empty: 0.5,
} as const;

/** Measure one parametric figure as a media primitive on a print mat; renderers draw admitted content unchanged. */
export function measureFigure(
  block: FigureBlock,
  width: number,
  style: ResolvedStyle,
  emphasis: 'inline' | 'figure' = 'inline',
): MeasuredContent {
  const preferred =
    emphasis === 'figure'
      ? style.contentSizing.figureBox[block.size]
      : style.contentSizing.widths[block.size].preferred;
  const targetWidth = Math.min(mattedWidth(width), preferred);
  const colors = palette(style);
  const svg = document_(drawFigure(block, colors), colors);
  const media: MediaPrimitive = {
    kind: 'media',
    digest: `figure:${digestOf(svg)}`,
    alt: altText(block),
    dataUri: `data:image/svg+xml;base64,${encodeBase64(svg)}`,
    x: 0,
    y: 0,
    width: targetWidth,
    height: targetWidth * (VIEW.height / VIEW.width),
    fit: 'contain',
  };
  return printMat(media, width, style, false);
}

/** Closed form dispatch keeps new artwork inside this module; projection orchestration never learns shapes. */
const drawers: Readonly<Record<FigureForm, (block: FigureBlock, palette: Palette) => string>> = {
  vessel: (block, palette) => vessel(block, palette),
  'layered-bed': (block, palette) => layeredBed(block, palette),
  screen: (block, palette) => screen(block, palette),
  gauge: (block, palette) => gauge(block, palette),
  window: (block, palette) => windowFigure(block, palette),
  gate: (block, palette) => gate(block, palette),
  stack: (block, palette) => stackFigure(block, palette),
  store: (block, palette) => store(block, palette),
  queue: (block, palette) => queue(block, palette),
  cloud: (block, palette) => cloud(block, palette),
};

/** Draw the admitted form once; Model owns parameter validity before projection runs. */
function drawFigure(
  block: FigureBlock,
  palette: Palette,
): string {
  return drawers[block.form](block, palette);
}

/** Vessel: glass tank with a lit liquid column, settling particles and optional agitator or mark. */
function vessel(
  block: FigureBlock,
  palette: Palette,
): string {
  const specific =
    block.form === 'vessel'
      ? block
      : { level: 'half' as const, agitator: false, mark: 'none' as const };
  const top = 30;
  const depth = 100;
  const liquidTop = top + depth - depth * LEVEL_FRACTION[specific.level];
  const parts = [
    pool(120, 134, 70, 7),
    tank(palette),
    `<rect x="66" y="${liquidTop}" width="108" height="${top + depth - liquidTop}" fill="url(#charge)"/>`,
    `<ellipse cx="120" cy="${liquidTop + 1}" rx="50" ry="3.5" fill="${palette.accent}" opacity="0.3"/>`,
    `<rect x="66" y="${liquidTop}" width="108" height="2.5" fill="${palette.lit}" opacity="0.5"/>`,
    `<rect x="69" y="38" width="9" height="82" rx="4.5" fill="url(#sheen)"/>`,
    sediment(2 + Number(specific.agitator) * 3, top + depth, palette.accentAlt),
    agitatorMark(specific.agitator, top, palette.ink),
    markBadge(specific.mark, 168, 96, palette),
  ];
  return parts.join('');
}

/** Agitated vessels carry a shaft; calm vessels carry nothing. */
function agitatorMark(
  on: boolean,
  top: number,
  ink: string,
): string {
  return on ? agitator(top, ink) : '';
}

/** Layered bed: glass tank over lit strata; separated bands step from tint to ink under the flow. */
function layeredBed(
  block: FigureBlock,
  palette: Palette,
): string {
  const level = block.form === 'layered-bed' ? block.level : 'full';
  const top = 30;
  const depth = 100;
  const bedTop = top + depth * 0.45;
  const strata = [
    { fill: palette.soft, opacity: FILL.strataSoft },
    { fill: palette.accentAlt, opacity: FILL.strataAlt },
    { fill: palette.ink, opacity: FILL.strataInk },
  ]
    .map(
      (layer, index) =>
        `<rect x="66" y="${bedTop + index * 18}" width="108" height="16" fill="${layer.fill}" opacity="${layer.opacity}"/>` +
        `<rect x="66" y="${bedTop + index * 18}" width="108" height="1.5" fill="${palette.lit}" opacity="0.25"/>`,
    )
    .join('');
  const liquidTop = top + depth * 0.45 * (1 - LEVEL_FRACTION[level]);
  return [
    pool(120, 134, 70, 7),
    tank(palette),
    `<rect x="66" y="${liquidTop}" width="108" height="${bedTop - liquidTop}" fill="url(#charge)"/>`,
    `<rect x="66" y="${liquidTop}" width="108" height="2.5" fill="${palette.lit}" opacity="0.5"/>`,
    strata,
    `<rect x="69" y="38" width="9" height="82" rx="4.5" fill="url(#sheen)"/>`,
    inflowArrow(top, palette),
  ].join('');
}

/** Screen: cylindrical slats arrest glowing debris while the flow passes through. */
function screen(
  block: FigureBlock,
  palette: Palette,
): string {
  const debris = block.form === 'screen' ? block.debris : 'some';
  const bars = [0, 1, 2]
    .map(
      (index) =>
        `<rect x="${112 + index * 8}" y="25" width="5" height="100" rx="2.5" fill="url(#metal)" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/>`,
    )
    .join('');
  const caught =
    debris === 'some'
      ? [0, 1, 2].map((index) => blob(96 - index * 10, 45 + index * 26, 5, palette.ink)).join('')
      : '';
  return [
    pool(124, 133, 36, 5),
    flowArrow(30, 75, 96, palette),
    flowArrow(140, 75, 210, palette),
    bars,
    caught,
  ].join('');
}

/** Gauge: gradient dial with an accent-lit needle; level selects the measured angle, never a raw degree. */
function gauge(
  block: FigureBlock,
  palette: Palette,
): string {
  const level = block.form === 'gauge' ? block.level : 'half';
  const cx = 120;
  const cy = 110;
  const radius = 60;
  const angle = (NEEDLE_ANGLE[level] * Math.PI) / 180;
  const tipX = cx + radius * 0.75 * Math.sin(angle);
  const tipY = cy - radius * 0.75 * Math.cos(angle);
  const face = `<path d="M${cx - radius} ${cy} a${radius} ${radius} 0 0 1 ${radius * 2} 0 Z" fill="url(#dial)"/>`;
  const ticks = [-60, -30, 0, 30, 60]
    .map((degree) => tick(cx, cy, radius, degree, palette.soft))
    .join('');
  return [
    pool(120, 126, 68, 7),
    face,
    arc(cx, cy, radius, palette.ink),
    ticks,
    dot(tipX, tipY, 15, 'url(#chargeGlow)'),
    line(cx, cy, tipX, tipY, palette.accent, 5),
    dot(cx, cy, 7, palette.ink),
    dot(cx, cy, 2.5, palette.lit),
  ].join('');
}

/** Window: four glass compartments charge from the stable prefix; a budget bar repeats the fill level. */
function windowFigure(
  block: FigureBlock,
  palette: Palette,
): string {
  const fill = block.form === 'window' ? block.fill : 'half';
  const charged = 200 * LEVEL_FRACTION[fill];
  const compartments = [0, 1, 2, 3]
    .map(
      (index) =>
        `<rect x="${20 + index * 50}" y="55" width="46" height="40" rx="8" fill="url(#glass)" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/>`,
    )
    .join('');
  const charge = `<rect x="23" y="58" width="${Math.max(0, charged - 6)}" height="34" fill="url(#charge)"/><rect x="23" y="58" width="${Math.max(0, charged - 6)}" height="2" fill="${palette.lit}" opacity="0.5"/>`;
  const outlines = [0, 1, 2, 3]
    .map(
      (index) =>
        `<rect x="${20 + index * 50}" y="55" width="46" height="40" rx="8" fill="none" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/>`,
    )
    .join('');
  const budget = `<rect x="20" y="115" width="200" height="6" rx="3" fill="${palette.wash}" stroke="${palette.soft}" stroke-width="1"/><rect x="20" y="115" width="${charged}" height="6" rx="3" fill="url(#charge)"/>`;
  return [pool(120, 129, 94, 6), compartments, charge, outlines, budget].join('');
}

/** Gate: glowing candidates converge on one admission column; admitted streams exit as light beams. */
function gate(
  block: FigureBlock,
  palette: Palette,
): string {
  const pass = block.form === 'gate' ? block.pass : 'few';
  const candidates = [0, 1, 2, 3, 4]
    .map(
      (index) =>
        dot(34, 35 + index * 20, 5, 'url(#blob)') +
        line(44, 35 + index * 20, 124, 65 + index * 5, palette.soft, STROKE.detail),
    )
    .join('');
  const bar = `<rect x="124" y="45" width="16" height="70" rx="8" fill="url(#metal)" stroke="${palette.ink}" stroke-width="${STROKE.frame}"/>`;
  const sheen = line(128, 52, 128, 108, palette.lit, 2.5);
  const admitted = Array.from({ length: PASS_COUNT[pass] }, (_, index) =>
    beamArrow(150, 65 + index * 25, 212, palette),
  ).join('');
  return [pool(132, 122, 28, 5), candidates, bar, sheen, admitted].join('');
}

/** Stack: ordered layers with the priority band charged; count stays semantic, never a raw number. */
function stackFigure(
  block: FigureBlock,
  palette: Palette,
): string {
  const layers = block.form === 'stack' ? block.layers : 'some';
  const count = LAYER_COUNT[layers];
  const bands = Array.from({ length: count }, (_, index) =>
    index === 0
      ? `<rect x="40" y="28" width="160" height="20" rx="8" fill="url(#charge)" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/><rect x="44" y="31" width="152" height="2" rx="1" fill="${palette.lit}" opacity="0.5"/>`
      : `<rect x="40" y="${28 + index * 24}" width="160" height="20" rx="8" fill="${palette.wash}" opacity="${FILL.empty}" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/>`,
  ).join('');
  return [
    pool(120, 34 + count * 24, 88, 6),
    `<ellipse cx="120" cy="38" rx="88" ry="16" fill="url(#chargeGlow)"/>`,
    bands,
  ].join('');
}

/** Gate outputs are one or two admitted streams, by semantic pass only. */
const PASS_COUNT: Readonly<Record<'one' | 'few', number>> = { one: 1, few: 2 };

/** Store: database cylinder; a luminous mouth over a plated metallic body, the canonical persistence glyph. */
function store(
  _block: FigureBlock,
  palette: Palette,
): string {
  const body = `<path d="M60 44 v62 a60 13 0 0 0 120 0 v-62" fill="url(#metal)" stroke="${palette.ink}" stroke-width="${STROKE.frame}"/>`;
  const sheen = `<rect x="70" y="52" width="9" height="48" rx="4.5" fill="${palette.lit}" opacity="0.2"/>`;
  const mouth = `<ellipse cx="120" cy="44" rx="60" ry="13" fill="url(#mouth)" stroke="${palette.ink}" stroke-width="${STROKE.frame}"/>`;
  const rim = `<path d="M60 44 a60 13 0 0 1 120 0" fill="none" stroke="${palette.lit}" stroke-width="2" opacity="0.45"/>`;
  const plates = [68, 88]
    .map(
      (y) =>
        `<path d="M60 ${y} a60 13 0 0 0 120 0" fill="none" stroke="${palette.soft}" stroke-width="${STROKE.detail}"/>`,
    )
    .join('');
  return [pool(120, 124, 70, 8), body, sheen, mouth, rim, plates].join('');
}

/** Occupied queue cells per semantic level; backlog depth never carries a raw count. */
const QUEUE_CELLS: Readonly<Record<FigureLevel, number>> = { low: 1, half: 2, full: 3 };

/** Queue: backlog pipe; occupied cells glow from within and one stream exits. */
function queue(
  block: FigureBlock,
  palette: Palette,
): string {
  const level = block.form === 'queue' ? block.level : 'half';
  const occupied = QUEUE_CELLS[level];
  const cells = [0, 1, 2, 3]
    .map((index) =>
      index < occupied
        ? dot(52 + index * 44, 75, 24, 'url(#chargeGlow)') +
          `<rect x="${32 + index * 44}" y="57" width="40" height="36" rx="6" fill="url(#charge)" stroke="${palette.ink}" stroke-width="${STROKE.detail}"/>` +
          `<rect x="${36 + index * 44}" y="60" width="32" height="2" rx="1" fill="${palette.lit}" opacity="0.45"/>`
        : `<rect x="${32 + index * 44}" y="57" width="40" height="36" rx="6" fill="${palette.wash}" opacity="${FILL.empty}" stroke="${palette.soft}" stroke-width="${STROKE.detail}"/>`,
    )
    .join('');
  return [
    pool(120, 101, 96, 6),
    flowArrow(8, 75, 28, palette),
    cells,
    flowArrow(212, 75, 232, palette),
  ].join('');
}

/** Cloud: external network boundary; a lit volume of merged arcs with signal pulses inside. */
function cloud(
  _block: FigureBlock,
  palette: Palette,
): string {
  const outline = `<path d="M72 108 a20 20 0 0 1 -4 -39 a26 26 0 0 1 50 -8 a21 21 0 0 1 30 26 a17 17 0 0 1 -8 21 z" fill="url(#cloud)" stroke="${palette.ink}" stroke-width="${STROKE.frame}" stroke-linejoin="round"/>`;
  const pulses = [96, 120, 144]
    .map((x) => `<circle cx="${x}" cy="88" r="3" fill="${palette.accent}" opacity="0.6"/>`)
    .join('');
  return [pool(108, 120, 56, 7), outline, pulses].join('');
}

/** Stack depth is a small closed vocabulary; authors never count pixels. */
const LAYER_COUNT: Readonly<Record<'few' | 'some' | 'many', number>> = { few: 3, some: 4, many: 5 };

/** Shared glass tank reused by vessel and bed forms; geometry lives once. */
function tank(palette: Palette): string {
  return `<rect x="60" y="30" width="120" height="100" rx="8" fill="url(#glass)" stroke="${palette.ink}" stroke-width="${STROKE.frame}"/>`;
}

/** Soft elliptical contact pool grounds one object on the stage; shade deepens on dark themes and prints on light. */
function pool(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#pool)"/>`;
}

/** Settling particles gather near the vessel floor; count stays tiny and deterministic. */
function sediment(
  count: number,
  floor: number,
  fill: string,
): string {
  return Array.from({ length: count }, (_, index) =>
    dot(80 + index * 18, floor - 8 - (index % 2) * 6, 3, fill),
  ).join('');
}

/** Agitator shaft and paddle mark active mixing vessels. */
function agitator(
  top: number,
  stroke: string,
): string {
  return (
    line(120, top - 18, 120, top + 58, stroke, STROKE.line) +
    line(102, top + 58, 138, top + 58, stroke, STROKE.line)
  );
}

/** Inflow arrow signals media entering the bed from above, with a faint accent trail behind it. */
function inflowArrow(
  top: number,
  palette: Palette,
): string {
  const trail = `<line x1="120" y1="${top - 22}" x2="120" y2="${top - 2}" stroke="${palette.accent}" stroke-width="8" stroke-linecap="round" stroke-opacity="0.2"/>`;
  return `${trail}${line(120, top - 22, 120, top - 2, palette.ink, STROKE.line)}<path d="m113 ${top - 10} 7 10 7-10" fill="none" stroke="${palette.ink}" stroke-width="${STROKE.line}" stroke-linejoin="round"/>`;
}

/** Horizontal flow segment with an arrowhead pointing right and a faint accent light trail. */
function flowArrow(
  x1: number,
  y: number,
  x2: number,
  palette: Palette,
): string {
  const trail = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round" stroke-opacity="0.2"/>`;
  return `${trail}${line(x1, y, x2, y, palette.ink, STROKE.line)}<path d="m${x2 - 9} ${y - 7} 10 7-10 7" fill="none" stroke="${palette.ink}" stroke-width="${STROKE.line}" stroke-linejoin="round"/>`;
}

/** Admitted stream: a beam that fades as it leaves the gate, tipped with a solid accent head. */
function beamArrow(
  x1: number,
  y: number,
  x2: number,
  palette: Palette,
): string {
  const beam = `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="url(#beam)" stroke-width="${STROKE.line}" stroke-linecap="round"/>`;
  const head = `<path d="m${x2 - 9} ${y - 7} 10 7-10 7" fill="none" stroke="${palette.accent}" stroke-opacity="0.85" stroke-width="${STROKE.line}" stroke-linejoin="round"/>`;
  return beam + head;
}

/** Badge frames are a closed table; badges never become free artwork. */
const badgeFrames: Readonly<
  Record<'check' | 'shield', (x: number, y: number, palette: Palette) => string>
> = {
  shield: (x, y, palette) =>
    `<circle cx="${x + 7}" cy="${y + 14}" r="18" fill="url(#okGlow)"/><path d="M${x} ${y} l14 6 v12 c0 10-7 16-14 19 c-7-3-14-9-14-19 v-12 z" fill="${palette.tint}" stroke="${palette.success}" stroke-width="${STROKE.detail}"/>`,
  check: (x, y, palette) =>
    `<circle cx="${x + 7}" cy="${y + 14}" r="20" fill="url(#okGlow)"/><circle cx="${x + 7}" cy="${y + 14}" r="14" fill="${palette.tint}" stroke="${palette.success}" stroke-width="${STROKE.detail}"/>`,
};

/** Mark badges certify a vessel; none carries no badge at all. */
function markBadge(
  mark: 'none' | 'check' | 'shield',
  x: number,
  y: number,
  palette: Palette,
): string {
  if (mark === 'none') return '';
  return (
    badgeFrames[mark](x, y, palette) +
    `<path d="m${x} ${y + 14} 6 6 10-11" fill="none" stroke="${palette.success}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** Gauge arc spans the upper half dial. */
function arc(
  cx: number,
  cy: number,
  radius: number,
  stroke: string,
): string {
  return `<path d="M${cx - radius} ${cy} a${radius} ${radius} 0 0 1 ${radius * 2} 0" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`;
}

/** One dial tick at a degree offset from vertical. */
function tick(
  cx: number,
  cy: number,
  radius: number,
  degree: number,
  stroke: string,
): string {
  const angle = (degree * Math.PI) / 180;
  const inner = radius * 0.82;
  return line(
    cx + inner * Math.sin(angle),
    cy - inner * Math.cos(angle),
    cx + radius * Math.sin(angle),
    cy - radius * Math.cos(angle),
    stroke,
    STROKE.detail,
  );
}

/** Straight segment painter. */
function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width: number,
): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

/** Filled circle painter; fills may reference document gradients. */
function dot(
  cx: number,
  cy: number,
  r: number,
  fill: string,
): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

/** Soft debris blob caught against a screen, lit from within. */
function blob(
  cx: number,
  cy: number,
  r: number,
  stroke: string,
): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#blob)" stroke="${stroke}" stroke-width="1.5"/>`;
}

/** Palette derives only from resolved tokens; figures re-theme automatically with the collection theme. */
function palette(style: ResolvedStyle): Palette {
  const tones = stageTones(style);
  return {
    ink: style.text,
    wash: style.surface,
    tint: rolePaint(style, 'neutral', style.surface).fill,
    soft: style.border,
    accent: rolePaint(style, 'primary', style.secondary).stroke,
    accentAlt: rolePaint(style, 'decision', style.secondary).stroke,
    success: rolePaint(style, 'success', style.secondary).stroke,
    lit: tones.lit,
    shade: tones.shade,
  };
}

/** Named roles fall back to neutral inks when a theme omits them; absence never erases the figure. */
function rolePaint(
  style: ResolvedStyle,
  name: string,
  fallback: string,
): { readonly fill: string; readonly stroke: string } {
  const role = style.roles[name];
  return role === undefined ? { fill: fallback, stroke: fallback } : role;
}

/** Accessible name and outline entry describe intent, never pixel content. */
function altText(block: FigureBlock): string {
  return `${block.form} figure${figureDetail(block)}`;
}

/** Chosen fill-level parameters join the accessible name; presence flags stay visible in the art. */
function figureDetail(block: FigureBlock): string {
  const values = ['level', 'fill', 'pass', 'layers'].flatMap((key) =>
    key in block ? [String(block[key as keyof FigureBlock])] : [],
  );
  return values.length === 0 ? '' : `, ${values.join(' ')}`;
}

/** Deterministic identity for renderer caches; artwork bytes fully determine the digest. */
function digestOf(svg: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < svg.length; index += 1) {
    hash ^= svg.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

/** Generated artwork is pure ASCII, so a local encoder keeps platform base64 out of core. */
function encodeBase64(ascii: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < ascii.length; index += 3) {
    const chunk =
      (ascii.charCodeAt(index) << 16) |
      (codeOrZero(ascii, index + 1) << 8) |
      codeOrZero(ascii, index + 2);
    output += quartet(alphabet, chunk, ascii.length - index);
  }
  return output;
}

/** Missing tail bytes read as zero and are masked by padding. */
function codeOrZero(
  text: string,
  index: number,
): number {
  return index < text.length ? text.charCodeAt(index) : 0;
}

/** One 24-bit chunk becomes four alphabet characters with tail padding. */
function quartet(
  alphabet: string,
  chunk: number,
  remaining: number,
): string {
  const pads = 3 - Math.min(remaining, 3);
  const body = [(chunk >> 18) & 63, (chunk >> 12) & 63, (chunk >> 6) & 63, chunk & 63]
    .map((unit) => alphabet[unit])
    .join('');
  return body.slice(0, 4 - pads) + '='.repeat(pads);
}

/** One gradient stop: offset, palette color and graduated opacity; artwork never hardcodes a color. */
type Stop = readonly [offset: number, color: string, opacity: number];

/** Linear gradient painter; vertical by default, horizontal for beams and metal. */
function linear(
  id: string,
  stops: readonly Stop[],
  vertical = true,
): string {
  const [x1, y1, x2, y2] = vertical ? [0, 0, 0, 1] : [0, 0, 1, 0];
  return `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops
    .map(stop)
    .join('')}</linearGradient>`;
}

/** Radial gradient painter; defaults center the falloff in the painted bounds. */
function radial(
  id: string,
  stops: readonly Stop[],
  cx = 0.5,
  cy = 0.5,
  r = 0.5,
): string {
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops
    .map(stop)
    .join('')}</radialGradient>`;
}

/** One stop with graduated stop-opacity; the palette hex stays the only color source. */
function stop([offset, color, opacity]: Stop): string {
  return `<stop offset="${offset}" stop-color="${color}" stop-opacity="${opacity}"/>`;
}

/** The shared studio lighting rig: every form draws from the same token-derived gradients. */
function studioLights(palette: Palette): string {
  return [
    linear('plinth', [
      [0, palette.tint, 1],
      [1, palette.wash, 1],
    ]),
    linear('plinthEdge', [
      [0, palette.lit, 0.6],
      [0.25, palette.soft, 0.5],
      [1, palette.soft, 0.35],
    ]),
    radial('pool', [
      [0, palette.shade, 0.5],
      [0.7, palette.shade, 0.22],
      [1, palette.shade, 0],
    ]),
    linear('charge', [
      [0, palette.accent, 0.95],
      [1, palette.accent, 0.45],
    ]),
    radial('chargeGlow', [
      [0, palette.accent, 0.5],
      [1, palette.accent, 0],
    ]),
    radial('mouth', [
      [0, palette.accent, 0.95],
      [1, palette.accent, 0.5],
    ]),
    linear(
      'metal',
      [
        [0, palette.wash, 1],
        [0.35, palette.tint, 1],
        [1, palette.wash, 1],
      ],
      false,
    ),
    linear('sheen', [
      [0, palette.lit, 0.4],
      [1, palette.lit, 0],
    ]),
    radial(
      'dial',
      [
        [0, palette.tint, 1],
        [1, palette.wash, 0.8],
      ],
      0.5,
      0.3,
      0.85,
    ),
    radial(
      'cloud',
      [
        [0, palette.tint, 1],
        [1, palette.wash, 0.9],
      ],
      0.38,
      0.3,
      0.9,
    ),
    linear(
      'beam',
      [
        [0, palette.accent, 0.9],
        [1, palette.accent, 0.15],
      ],
      false,
    ),
    radial(
      'blob',
      [
        [0, palette.accent, 1],
        [1, palette.accentAlt, 0.7],
      ],
      0.35,
      0.3,
      0.9,
    ),
    radial('okGlow', [
      [0, palette.success, 0.4],
      [1, palette.success, 0],
    ]),
    linear('glass', [
      [0, palette.wash, 0.9],
      [1, palette.wash, 0.3],
    ]),
  ].join('');
}

/** Wrap form artwork on a glass plinth: vertical surface gradient, top-light edge and a faint inner rim. */
function document_(
  body: string,
  palette: Palette,
): string {
  const stage =
    `<rect x="6" y="4" width="228" height="142" rx="18" fill="url(#plinth)" stroke="url(#plinthEdge)" stroke-width="2"/>` +
    `<rect x="9" y="7" width="222" height="136" rx="15" fill="none" stroke="${palette.lit}" stroke-opacity="0.14" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}"><defs>${studioLights(palette)}</defs>${stage}${body}</svg>`;
}

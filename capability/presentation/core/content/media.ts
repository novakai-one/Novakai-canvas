import type { ContentBlock, InputCollection } from '../../contract/records/input.js';
import type { MeasuredContent, Primitive } from '../../contract/records/visual.js';
import type { AssetReader } from '../../contract/ports/resources.js';
import { visualAsset } from '../../contract/records/style.js';
import type { ResolvedStyle, VisualAsset } from '../../contract/records/style.js';
import { requireValue, reject, parse } from '../validation/outcomes.js';

type MediaPrimitive = Extract<Primitive, { kind: 'media' }>;
type BadgePrimitive = Extract<Primitive, { kind: 'badge' }>;

/** Gallery tones derive from the resolved palette by luminance, so ink and paper stay physical without theme branches. */
export interface StageTones {
  readonly lit: string;
  readonly shade: string;
  readonly mat: string;
  readonly hairline: string;
  readonly dark: boolean;
}

/** Print-mat geometry is one house-style table; editors never place mats by hand. */
const MAT = { margin: 6, shadowX: 3, shadowY: 4 } as const;
/** Offset shadows deepen on dark stages and soften on paper; alpha is a strength, never a color. */
const MAT_SHADOW_ALPHA: Readonly<Record<'light' | 'dark', string>> = { light: '2e', dark: '8c' };

/** Resolve the light/shade pair from palette hexes; the lighter tone speculars, the darker one grounds. */
export function stageTones(style: ResolvedStyle): StageTones {
  const neutral = style.roles['neutral'];
  return {
    lit: lighter(style.text, neutral?.fill ?? style.surface),
    shade: darker(style.text, style.surface),
    mat: neutral?.fill ?? style.surface,
    hairline: style.border,
    dark: luminance(style.surface) < 0.35,
  };
}

/** Interior width left for artwork once the mat reveal and offset shadow are reserved. */
export function mattedWidth(width: number): number {
  return Math.max(1, width - MAT.margin * 2 - MAT.shadowX);
}

/** Wrap one admitted media rectangle in a print mat: offset hard shadow, raised board, optional hairline. */
export function printMat(
  media: MediaPrimitive,
  width: number,
  style: ResolvedStyle,
  hairline: boolean,
): MeasuredContent {
  const tones = stageTones(style);
  const shadowAlpha = MAT_SHADOW_ALPHA[tones.dark ? 'dark' : 'light'];
  const visual = media.width + MAT.margin * 2 + MAT.shadowX;
  const matX = Math.max(0, (width - visual) / 2);
  const placed = { ...media, x: matX + MAT.margin, y: MAT.margin };
  const shadow: BadgePrimitive = {
    kind: 'badge',
    x: matX + MAT.shadowX,
    y: MAT.shadowY,
    width: media.width + MAT.margin * 2,
    height: media.height + MAT.margin * 2,
    radius: style.radius + MAT.margin,
    fill: `${tones.shade}${shadowAlpha}`,
    stroke: `${tones.shade}00`,
    strokeWidth: style.stroke,
  };
  const mat: BadgePrimitive = {
    kind: 'badge',
    x: matX,
    y: 0,
    width: media.width + MAT.margin * 2,
    height: media.height + MAT.margin * 2,
    radius: style.radius + MAT.margin,
    fill: tones.mat,
    stroke: tones.hairline,
    strokeWidth: style.stroke,
  };
  return {
    width,
    height: media.height + MAT.margin * 2 + MAT.shadowY,
    anchors: [],
    outline: [media.alt],
    primitives: [shadow, mat, placed, ...(hairline ? [innerEdge(placed, style, tones)] : [])],
  };
}

/** The hairline catches the artwork edge like the inner bevel of a cut mat; transparent fill keeps the art visible. */
function innerEdge(
  media: MediaPrimitive,
  style: ResolvedStyle,
  tones: StageTones,
): BadgePrimitive {
  return {
    kind: 'badge',
    x: media.x,
    y: media.y,
    width: media.width,
    height: media.height,
    radius: style.radius + 2,
    fill: `${tones.mat}00`,
    stroke: tones.hairline,
    strokeWidth: style.stroke,
  };
}

/** sRGB relative luminance keeps tone choice token-derived; theme names never branch artwork. */
function luminance(hex: string): number {
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Lighter of two palette hexes by relative luminance. */
function lighter(
  a: string,
  b: string,
): string {
  return luminance(a) >= luminance(b) ? a : b;
}

/** Darker of two palette hexes by relative luminance. */
function darker(
  a: string,
  b: string,
): string {
  return luminance(a) <= luminance(b) ? a : b;
}

/** Resolve one binding exactly; missing assets do not become decorative blank rectangles. */
export function measureMedia(
  block: Extract<ContentBlock, { kind: 'image' | 'icon' }>,
  collection: InputCollection,
  width: number,
  style: ResolvedStyle,
  assets: AssetReader,
  emphasis: 'inline' | 'figure' = 'inline',
): MeasuredContent {
  const binding = collection.assets.find((value) => value.id === block.asset);
  if (!binding) return reject('missing-resource', block.asset, 'Asset binding is absent');
  const resource = parse(visualAsset, requireValue(assets.read(binding.digest.slice(7))));
  if (`sha256:${resource.digest}` !== binding.digest)
    return reject('missing-resource', binding.id, 'Asset reader returned a different digest');
  return slot(block, resource, binding.alt, width, style, emphasis);
}
type MediaBlock = Extract<ContentBlock, { kind: 'image' | 'icon' }>;
/** Bounded media slots center in the final node interior; public projection owns resource rejection. */
function slot(
  block: MediaBlock,
  resource: VisualAsset,
  alt: string,
  width: number,
  style: ResolvedStyle,
  emphasis: 'inline' | 'figure',
): MeasuredContent {
  const preferred = preferredWidth(block, style, emphasis);
  if (block.kind === 'icon') return iconSlot(block, resource, alt, width, preferred);
  return imageSlot(block, resource, alt, width, style, preferred);
}

/** Icons stay bare inline glyphs; a mat around a bullet-sized glyph would read as clutter. */
function iconSlot(
  block: MediaBlock,
  resource: VisualAsset,
  alt: string,
  width: number,
  preferred: number,
): MeasuredContent {
  const targetWidth = Math.min(width, preferred);
  const media: MediaPrimitive = {
    kind: 'media',
    digest: resource.digest,
    alt,
    dataUri: `data:${resource.mediaType};base64,${resource.base64}`,
    x: (width - targetWidth) / 2,
    y: 0,
    width: targetWidth,
    height: targetWidth,
    fit: block.fit,
  };
  return { width, height: targetWidth, anchors: [], outline: [alt], primitives: [media] };
}

/** Images sit on a measured print mat; contained fit retains portrait extent, cover stays a bounded square. */
function imageSlot(
  block: MediaBlock,
  resource: VisualAsset,
  alt: string,
  width: number,
  style: ResolvedStyle,
  preferred: number,
): MeasuredContent {
  const targetWidth = Math.min(mattedWidth(width), preferred);
  const media: MediaPrimitive = {
    kind: 'media',
    digest: resource.digest,
    alt,
    dataUri: `data:${resource.mediaType};base64,${resource.base64}`,
    x: 0,
    y: 0,
    width: targetWidth,
    height: block.fit === 'cover' ? targetWidth : targetWidth * (resource.height / resource.width),
    fit: block.fit,
  };
  return printMat(media, width, style, true);
}

/** Figure emphasis is a semantic composition choice, while inline symbols retain their compact slots. */
function preferredWidth(
  block: MediaBlock,
  style: ResolvedStyle,
  emphasis: 'inline' | 'figure',
): number {
  if (emphasis === 'figure') return style.contentSizing.figureBox[block.size];
  if (block.kind === 'icon') return style.contentSizing.iconBox[block.size];
  return style.contentSizing.widths[block.size].preferred;
}

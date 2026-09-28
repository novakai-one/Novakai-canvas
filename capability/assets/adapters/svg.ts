import { SaxesParser } from 'saxes';
import type { SaxesTagPlain } from 'saxes';
import { fail } from '../contract/errors.js';
import type { Result } from '../contract/errors.js';
import { limits } from '../contract/records/media.js';
import type { NormalizedMedia } from '../contract/records/media.js';
import type { MediaHandler } from '../contract/ports/media.js';

/**
 * Creates the SVG processor. It keeps SVG as vector content and emits a canonical, safe subset;
 * anything outside the subset is rejected, never repaired.
 *
 * Normalizing, in order (except that the root's size, step 6, is checked when the root element
 * opens, before later elements and step 5; every rejection is the same failure, so this is not
 * observable):
 * 1. the decoded bytes are at most {@link limits}.svgBytes and valid UTF-8;
 * 2. strict XML parsing: no DOCTYPE, no processing instructions, no parse errors;
 * 3. each element: an allowed SVG element, the first one is `svg`, at most
 *    {@link limits}.svgElements elements and {@link limits}.svgDepth levels;
 * 4. each attribute: an allowed name, at most 65536 characters, `xmlns` only the SVG namespace, no
 *    URL schemes (`http:`, `https:`, `file:`, `data:`, `javascript:`, `//`) or backslashes, and
 *    `url(...)` only as a whole local `url(#id)`; IDs are well-formed and unique; references are
 *    not allowed inside definition elements (`defs`, `marker`, `clipPath`, gradients);
 * 5. every referenced ID exists;
 * 6. the root has a positive finite width and height, at most {@link limits}.dimension, from its
 *    `width`/`height` (an optional `px` suffix) or else its `viewBox`;
 * 7. the output is at most {@link limits}.svgBytes after escaping.
 *
 * The output markup escapes all text and attribute values, sorts attributes by name, and gives
 * the root `xmlns`, `width` and `height`, so an admitted SVG normalizes to the same bytes again on
 * restore. Every rejection is `unsafe-media` at `svg`: "SVG violates the supported safe vector
 * subset". Recovery: the caller corrects the source; a rejected SVG is never staged.
 *
 * @returns The processor. Its `normalize` returns `image/svg+xml` media of kind `icon` with the
 * root's width and height, and never rejects.
 * @throws Never.
 */
export function createSvg(): MediaHandler {
  return { mediaTypes: ['image/svg+xml'], normalize: protectSvg };
}

/** The only allowed namespace. */
const namespace = 'http://www.w3.org/2000/svg';

/** The allowed element names. */
const elements: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'title',
  'desc',
  'marker',
  'clipPath',
  'linearGradient',
  'radialGradient',
  'stop',
]);

/** The allowed attribute names. No event handlers, styles, links or base URIs. */
const attributes: ReadonlySet<string> = new Set([
  'id',
  'xmlns',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'clip-path',
  'clip-rule',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerWidth',
  'markerHeight',
  'markerUnits',
  'refX',
  'refY',
  'orient',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
]);

/** Elements inside which a `url(#id)` reference is not allowed, so definitions cannot nest. */
const definitionElements: ReadonlySet<string> = new Set([
  'defs',
  'marker',
  'clipPath',
  'linearGradient',
  'radialGradient',
]);

/** The state of one normalization. It is never shared between files. */
interface SvgState {
  /** Every element opened so far, in order. */
  readonly tags: SaxesTagPlain[];
  /** The currently open elements. */
  readonly stack: SaxesTagPlain[];
  /** The output markup, in pieces. */
  readonly parts: string[];
  /** The IDs seen so far. */
  readonly ids: Set<string>;
  /** The IDs referenced by `url(#id)`. */
  readonly references: string[];
}

/** Normalizes the SVG; anything thrown becomes `unsafe-media` at `svg`. */
async function protectSvg(encoded: string): Promise<Result<NormalizedMedia>> {
  try {
    return { ok: true, value: normalizeSvg(encoded) };
  } catch {
    return fail('unsafe-media', 'svg', 'SVG violates the supported safe vector subset');
  }
}

/** Decodes the bytes (bounded, strict UTF-8), parses them and builds the normalized media. */
function normalizeSvg(encoded: string): NormalizedMedia {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength > limits.svgBytes) {
    rejectUnsafe();
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const state: SvgState = { tags: [], stack: [], parts: [], ids: new Set(), references: [] };
  parseSvg(source, state);
  return finishSvg(state);
}

/**
 * Parses the XML strictly, checking and serializing each element as it opens. An XML declaration
 * is allowed; a DOCTYPE, a processing instruction or a parse error is rejected.
 */
function parseSvg(
  source: string,
  state: SvgState,
): void {
  const parser = new SaxesParser({ xmlns: false });
  parser.on('doctype', rejectUnsafe);
  parser.on('processinginstruction', rejectUnsafe);
  parser.on('error', rejectUnsafe);
  parser.on('opentag', (tag) => openTag(state, tag));
  parser.on('closetag', () => closeTag(state));
  parser.on('text', (text) => state.parts.push(escapeXml(text)));
  parser.on('cdata', (text) => state.parts.push(escapeXml(text)));
  // `write` returns the parser itself.
  parser.write(source);
  parser.close();
}

/** Once the whole document is read: checks every reference exists and builds the output. */
function finishSvg(state: SvgState): NormalizedMedia {
  if (state.references.some((id) => !state.ids.has(id))) {
    rejectUnsafe();
  }
  const root = state.tags[0];
  if (!root) {
    rejectUnsafe();
  }
  const [width, height] = dimensions(root);
  const canonical = boundedMarkup(state.parts);
  return {
    base64: Buffer.from(canonical, 'utf8').toString('base64'),
    mediaType: 'image/svg+xml',
    kind: 'icon',
    width,
    height,
    fontFamily: null,
  };
}

/** Checks an opening element and its attributes, then records and serializes it. */
function openTag(
  state: SvgState,
  tag: SaxesTagPlain,
): void {
  checkElement(state, tag);
  state.stack.push(tag);
  Object.entries(tag.attributes).forEach(([name, value]) => inspectAttribute(state, name, value));
  state.parts.push(serializeTag(tag, state.tags.length === 0));
  state.tags.push(tag);
}

/** Closes the innermost open element. */
function closeTag(state: SvgState): void {
  const tag = state.stack.pop();
  if (!tag) {
    rejectUnsafe();
  }
  state.parts.push(`</${tag.name}>`);
}

/** Rejects the file. Every check calls this; the SVG is never repaired. */
function rejectUnsafe(): never {
  throw new Error('Unsupported or unsafe SVG');
}

/** Escapes `&`, `<`, `>` and `"` for output, in text and in (already entity-decoded) attribute values. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Checks the attribute name and length, then its value (`xmlns` must be the SVG namespace). */
function checkAttribute(
  name: string,
  value: string,
): void {
  if (!attributes.has(name) || value.length > 65536) {
    rejectUnsafe();
  }
  if (name === 'xmlns') {
    checkNamespace(value);
    return;
  }
  checkAttributeValue(value);
}

/** Rejects any namespace other than SVG's. */
function checkNamespace(value: string): void {
  if (value !== namespace) {
    rejectUnsafe();
  }
}

/** Rejects URL schemes and backslashes, then checks any `url(...)` is a whole local `url(#id)`. */
function checkAttributeValue(value: string): void {
  if (/(?:https?:|file:|data:|javascript:|\/\/)/i.test(value)) {
    rejectUnsafe();
  }
  if (value.includes('\\')) {
    rejectUnsafe();
  }
  checkLocalUrl(value);
}

/** A value that contains `url(` must be exactly `url(#id)`. */
function checkLocalUrl(value: string): void {
  if (!/url\s*\(/i.test(value)) {
    return;
  }
  if (!/^url\(#[A-Za-z_][A-Za-z0-9_.:-]*\)$/.test(value)) {
    rejectUnsafe();
  }
}

/** Records an ID; it must be well-formed and not seen before. */
function recordId(
  state: SvgState,
  id: string,
): void {
  if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(id) || state.ids.has(id)) {
    rejectUnsafe();
  }
  state.ids.add(id);
}

/** Records a `url(#id)` reference; it is not allowed inside a definition element. */
function recordReference(
  state: SvgState,
  value: string,
): void {
  if (!value.startsWith('url(#')) {
    return;
  }
  if (state.stack.some((tag) => definitionElements.has(tag.name))) {
    rejectUnsafe();
  }
  state.references.push(value.slice(5, -1));
}

/** Checks one attribute, then records it as an ID and as a reference where it applies. */
function inspectAttribute(
  state: SvgState,
  name: string,
  value: string,
): void {
  checkAttribute(name, value);
  if (name === 'id') {
    recordId(state, value);
  }
  recordReference(state, value);
}

/** Checks the element is allowed, the root is `svg`, and the count and depth limits hold. */
function checkElement(
  state: SvgState,
  tag: SaxesTagPlain,
): void {
  if (!elements.has(tag.name)) {
    rejectUnsafe();
  }
  checkRoot(state, tag);
  checkElementBounds(state);
}

/** The first element must be `svg`. */
function checkRoot(
  state: SvgState,
  tag: SaxesTagPlain,
): void {
  if (state.tags.length !== 0) {
    return;
  }
  if (tag.name !== 'svg') {
    rejectUnsafe();
  }
}

/** Rejects more than the element limit or deeper nesting than the depth limit. */
function checkElementBounds(state: SvgState): void {
  if (state.tags.length >= limits.svgElements) {
    rejectUnsafe();
  }
  if (state.stack.length >= limits.svgDepth) {
    rejectUnsafe();
  }
}

/** The root's attributes, with `xmlns`, `width` and `height` set to the normalized values. */
function rootAttributes(tag: SaxesTagPlain): Readonly<Record<string, string>> {
  const [width, height] = dimensions(tag);
  return { ...tag.attributes, xmlns: namespace, width: String(width), height: String(height) };
}

/** Serializes an opening tag with its attributes sorted by name and escaped. */
function serializeTag(
  tag: SaxesTagPlain,
  root: boolean,
): string {
  const values = root ? rootAttributes(tag) : tag.attributes;
  const serialized = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, value]) => `${name}="${escapeXml(value)}"`)
    .join(' ');
  const suffix = serialized ? ' ' + serialized : '';
  return `<${tag.name}${suffix}>`;
}

/** Reads one root dimension: the attribute (an optional `px` suffix), or else the viewBox value. */
function dimension(
  value: string | undefined,
  fallback: number | undefined,
): number {
  const parsed = value === undefined ? fallback : Number(value.replace(/px$/, ''));
  if (typeof parsed !== 'number') {
    rejectUnsafe();
  }
  return boundedDimension(parsed);
}

/** Requires a positive finite dimension no larger than the dimension limit. */
function boundedDimension(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    rejectUnsafe();
  }
  if (value > limits.dimension) {
    rejectUnsafe();
  }
  return value;
}

/** The root's width and height, from its attributes or else the viewBox's third and fourth numbers. */
function dimensions(tag: SaxesTagPlain): readonly [number, number] {
  const viewBox =
    tag.attributes.viewBox
      ?.trim()
      .split(/[\s,]+/)
      .map(Number) ?? [];
  return [
    dimension(tag.attributes.width, viewBox[2]),
    dimension(tag.attributes.height, viewBox[3]),
  ];
}

/** Joins and trims the output, and requires it to fit the SVG byte limit after escaping. */
function boundedMarkup(parts: readonly string[]): string {
  const canonical = parts.join('').trim();
  if (Buffer.byteLength(canonical, 'utf8') > limits.svgBytes) {
    rejectUnsafe();
  }
  return canonical;
}

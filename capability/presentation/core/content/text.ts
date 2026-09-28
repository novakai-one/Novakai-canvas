import type { MeasurementPort, TextMetrics } from '../../contract/ports/measurement.js';
import type { MeasuredContent, TextRun } from '../../contract/records/visual.js';
import type { FontRef } from '../../contract/records/style.js';
import type { TextRequest } from '../../contract/types.js';
import { content as contentSchema } from '../../contract/records/visual.js';
import { requireValue, reject, parse } from '../validation/outcomes.js';
/** Exact font metrics are checked before they can become layout geometry. */
function measure(
  text: string,
  request: TextRequest,
  metrics: MeasurementPort,
): TextMetrics {
  const value = requireValue(metrics.measure(text, request.font, request.size));
  if (
    ![value.width, value.ascent, value.descent].every(
      (number) => Number.isFinite(number) && number >= 0,
    )
  )
    return reject('provider-failed', 'metrics', 'Invalid font measurement');
  return value;
}
/** Segment at grapheme boundaries, preserving combining characters and surrogate pairs as one unit. */
function graphemes(text: string): readonly string[] {
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return Array.from(segmenter.segment(text), (item) => item.segment);
}
/** Find a fitting prefix with exact font measurements at complete grapheme boundaries. */
function fittingEnd(
  units: readonly string[],
  start: number,
  request: TextRequest,
  metrics: MeasurementPort,
): number {
  let low = start;
  let high = units.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const width = measure(units.slice(start, middle).join(''), request, metrics).width;
    if (width <= request.width) low = middle;
    else high = middle - 1;
  }
  return Math.max(start + 1, low);
}
/** A word boundary is preferred, while an overlong identifier splits between whole graphemes. */
function wordEnd(
  units: readonly string[],
  start: number,
  end: number,
): number {
  if (end === units.length) return end;
  const space = units.slice(start, end).lastIndexOf(' ');
  return space > 0 ? start + space + 1 : end;
}
/** Explicit newlines are preserved; shaping work grows with wrapped lines instead of every prefix. */
function paragraph(
  text: string,
  request: TextRequest,
  metrics: MeasurementPort,
): readonly string[] {
  if (measure(text, request, metrics).width <= request.width) return [text];
  const units = graphemes(text);
  const lines: string[] = [];
  let start = 0;
  while (start < units.length) {
    const end = wordEnd(units, start, fittingEnd(units, start, request, metrics));
    lines.push(units.slice(start, end).join(''));
    start = end;
  }
  return lines;
}
/** Public text requests are bounded before native shaping; callers correct unsupported or oversized input. */
function checkRequest(request: TextRequest): void {
  if (request.text.length > 100000) reject('limit', 'text', 'Text block exceeds 100000 characters');
  if (
    ![request.width, request.size, request.lineHeight].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    reject('invalid-input', 'text', 'Text dimensions must be finite and positive');
}
/** A final run stores the actual shaped width and baseline used by both renderers. */
function run(
  text: string,
  index: number,
  lineHeight: number,
  request: TextRequest,
  metrics: MeasurementPort,
): TextRun {
  const measured = measure(text, request, metrics);
  return {
    kind: 'text',
    text,
    x: 0,
    y: index * lineHeight + measured.ascent,
    width: measured.width,
    font: request.font,
    size: request.size,
    fill: request.fill,
  };
}
/** Marker-free text shapes whole candidate strings exactly as before; no run splitting is introduced. */
function measurePlain(
  request: TextRequest,
  metrics: MeasurementPort,
): MeasuredContent {
  const lines = request.text.split('\n').flatMap((text) => paragraph(text, request, metrics));
  if (lines.length > 10000) return reject('limit', 'text', 'Text exceeds 10000 lines');
  return parse(contentSchema, finishPlain(lines, request, metrics));
}
/** Ascender/descender floor prevents line boxes from overlapping even under compact token preferences. */
function finishPlain(
  lines: readonly string[],
  request: TextRequest,
  metrics: MeasurementPort,
): MeasuredContent {
  const samples = lines.map((text) => measure(text, request, metrics));
  const lineHeight = Math.max(
    request.lineHeight,
    ...samples.map((value) => value.ascent + value.descent),
  );
  const primitives = lines.map((text, index) => run(text, index, lineHeight, request, metrics));
  return {
    width: Math.max(0, ...samples.map((value) => value.width)),
    height: lineHeight * lines.length,
    primitives,
    anchors: [],
    outline: [request.text],
  };
}

const ESCAPED = '\u0001';
/** Emphasis activates only with a strong face and at least one paired marker. */
function hasEmphasis(request: TextRequest): boolean {
  if (request.strong === undefined) return false;
  const parts = request.text.replaceAll('\\*', ESCAPED).split('*');
  return parts.length > 2 && parts.length % 2 === 1;
}
/** One font-tagged span; emphasis markers never leave this module as raw text. */
interface Piece {
  readonly text: string;
  readonly font: FontRef;
}
/** A measured word or space atom; wrapping sums cached metrics instead of re-shaping. */
interface Token {
  readonly text: string;
  readonly font: FontRef;
  readonly space: boolean;
  readonly metrics: TextMetrics;
}
interface TokenLines {
  readonly complete: readonly (readonly Token[])[];
  readonly current: readonly Token[];
}
/** Measure one span under its own font; strong spans shape with the strong face. */
function measureFont(
  text: string,
  font: FontRef,
  request: TextRequest,
  metrics: MeasurementPort,
): TextMetrics {
  return measure(text, { ...request, font }, metrics);
}
/** Paired `*…*` spans select the strong face; unpaired markers never reach this path. */
function pieces(
  text: string,
  request: TextRequest,
): readonly Piece[] {
  const parts = text.replaceAll('\\*', ESCAPED).split('*');
  return parts.flatMap((part, index) => piece(part, index, request));
}
/** Empty spans vanish; odd split indices carry the strong face. */
function piece(
  text: string,
  index: number,
  request: TextRequest,
): readonly Piece[] {
  const value = text.replaceAll(ESCAPED, '*');
  if (value === '') return [];
  return [{ text: value, font: pieceFont(index, request) }];
}
/** Alternating spans index the body/strong pair; the strong face is checked on this path. */
function pieceFont(
  index: number,
  request: TextRequest,
): FontRef {
  return [request.font, request.strong ?? request.font][index % 2] ?? request.font;
}
/** A span becomes measured word/space atoms; every token is shaped once under its own font. */
function words(
  piece: Piece,
  request: TextRequest,
  metrics: MeasurementPort,
): readonly Token[] {
  return piece.text.split(/( )/).flatMap((part) => token(part, piece.font, request, metrics));
}
/** Atoms are measured under their own face; nothing indivisible is clipped. */
function token(
  part: string,
  font: FontRef,
  request: TextRequest,
  metrics: MeasurementPort,
): readonly Token[] {
  if (part === '') return [];
  return split(
    {
      text: part,
      font,
      space: part === ' ',
      metrics: measureFont(part, font, request, metrics),
    },
    request,
    metrics,
  );
}
/** Words wider than the measure band pre-split into graphemes. */
function split(
  atom: Token,
  request: TextRequest,
  metrics: MeasurementPort,
): readonly Token[] {
  if (atom.space || atom.metrics.width <= request.width) return [atom];
  return graphemes(atom.text).map((char) => ({
    ...atom,
    text: char,
    metrics: measureFont(char, atom.font, request, metrics),
  }));
}
/** Keep a fitting candidate on its line; overflow breaks before the offending atom. */
function appendToken(
  state: TokenLines,
  next: Token,
  width: number,
): TokenLines {
  const candidate = sumWidths(state.current) + next.metrics.width;
  if (candidate <= width || state.current.length === 0)
    return { ...state, current: [...state.current, next] };
  return breakToken(state, next);
}
/** Prefer the last word boundary; unbroken identifiers split only between complete graphemes. */
function breakToken(
  state: TokenLines,
  next: Token,
): TokenLines {
  const boundary = state.current.findLastIndex((token) => token.space);
  if (boundary > 0)
    return {
      complete: [...state.complete, state.current.slice(0, boundary + 1)],
      current: [...state.current.slice(boundary + 1), next],
    };
  return { complete: [...state.complete, state.current], current: [next] };
}
/** Explicit source newlines remain line boundaries, including empty lines. */
function tokenParagraph(
  spans: readonly Piece[],
  request: TextRequest,
  metrics: MeasurementPort,
): readonly (readonly Token[])[] {
  const tokens = spans.flatMap((span) => words(span, request, metrics));
  const result = tokens.reduce<TokenLines>(
    (state, next) => appendToken(state, next, request.width),
    { complete: [], current: [] },
  );
  return [...result.complete, result.current];
}
function sumWidths(tokens: readonly Token[]): number {
  return tokens.reduce((total, token) => total + token.metrics.width, 0);
}
/** Baseline uses the line's tallest ascent so mixed faces align on one rule. */
function lineAscent(tokens: readonly Token[]): number {
  return Math.max(0, ...tokens.map((token) => token.metrics.ascent));
}
/** Consecutive same-font atoms join into one renderer run with an exact shaped width. */
function fontGroups(tokens: readonly Token[]): readonly (readonly Token[])[] {
  return tokens.slice(1).reduce<readonly (readonly Token[])[]>(
    (groups, token) => join(groups, token),
    tokens.slice(0, 1).map((token) => [token]),
  );
}
/** Same-face atoms extend the open run; a face change opens a new run. */
function join(
  groups: readonly (readonly Token[])[],
  token: Token,
): readonly (readonly Token[])[] {
  const last = groups.at(-1);
  if (last !== undefined && sameFont(last, token.font)) return extend(groups, last, token);
  return [...groups, [token]];
}
/** The open run's face is its first atom's face. */
function sameFont(
  group: readonly Token[],
  font: FontRef,
): boolean {
  return group[0]?.font === font;
}
/** The extended run replaces the open run at the end of the group list. */
function extend(
  groups: readonly (readonly Token[])[],
  last: readonly Token[],
  token: Token,
): readonly (readonly Token[])[] {
  return [...groups.slice(0, -1), [...last, token]];
}
/** A final run stores the actual shaped width, advance and baseline used by both renderers. */
function tokenRun(
  tokens: readonly Token[],
  x: number,
  y: number,
  request: TextRequest,
): TextRun {
  return {
    kind: 'text',
    text: tokens.map((token) => token.text).join(''),
    x,
    y,
    width: sumWidths(tokens),
    font: tokens[0]?.font ?? request.font,
    size: request.size,
    fill: request.fill,
  };
}
/** One line becomes advancing same-face runs sharing one baseline; empty lines keep an empty run. */
function lineRuns(
  tokens: readonly Token[],
  index: number,
  lineHeight: number,
  request: TextRequest,
  metrics: MeasurementPort,
): readonly TextRun[] {
  if (tokens.length === 0) return [emptyRun(index, lineHeight, request, metrics)];
  const y = index * lineHeight + lineAscent(tokens);
  return fontGroups(tokens).map((group, groupIndex, groups) =>
    tokenRun(group, sumWidths(groups.slice(0, groupIndex).flat()), y, request),
  );
}
/** Empty emphasis lines still own their vertical band, like the plain path. */
function emptyRun(
  index: number,
  lineHeight: number,
  request: TextRequest,
  metrics: MeasurementPort,
): TextRun {
  const measured = measure('', request, metrics);
  return {
    kind: 'text',
    text: '',
    x: 0,
    y: index * lineHeight + measured.ascent,
    width: 0,
    font: request.font,
    size: request.size,
    fill: request.fill,
  };
}
/** Emphasis text wraps and measures per run; renderer consumes these exact runs. */
function measureEmphasis(
  request: TextRequest,
  metrics: MeasurementPort,
): MeasuredContent {
  const lines = request.text
    .split('\n')
    .flatMap((text) => tokenParagraph(pieces(text, request), request, metrics));
  if (lines.length > 10000) return reject('limit', 'text', 'Text exceeds 10000 lines');
  return parse(contentSchema, finishEmphasis(lines, request, metrics));
}
/** Line height floors against both faces; markers never appear in the accessible outline. */
function finishEmphasis(
  lines: readonly (readonly Token[])[],
  request: TextRequest,
  metrics: MeasurementPort,
): MeasuredContent {
  const lineHeight = Math.max(
    request.lineHeight,
    ...lines.flat().map((token) => token.metrics.ascent + token.metrics.descent),
  );
  const primitives = lines.flatMap((tokens, index) =>
    lineRuns(tokens, index, lineHeight, request, metrics),
  );
  return {
    width: Math.max(0, ...lines.map(sumWidths)),
    height: lineHeight * lines.length,
    primitives,
    anchors: [],
    outline: lines.map((tokens) => tokens.map((token) => token.text).join('')),
  };
}
/** Wrap and measure once. Renderer consumes these exact runs; Authoring owns preview rejection/retry. */
export function measureText(
  request: TextRequest,
  metrics: MeasurementPort,
): MeasuredContent {
  checkRequest(request);
  if (!hasEmphasis(request)) return measurePlain(request, metrics);
  return measureEmphasis(request, metrics);
}
/** Move measured local content by an explicit typography offset; this is not global diagram layout. */
export function offset(
  content: MeasuredContent,
  x: number,
  y: number,
): MeasuredContent {
  return {
    ...content,
    primitives: content.primitives.map((item) => movePrimitive(item, x, y)),
    anchors: content.anchors.map((anchor) => ({ ...anchor, x: anchor.x + x, y: anchor.y + y })),
  };
}
/** Each primitive family names its own coordinate fields; no arbitrary JSON path mutation. */
function movePrimitive(
  item: MeasuredContent['primitives'][number],
  x: number,
  y: number,
): MeasuredContent['primitives'][number] {
  if (item.kind === 'rule')
    return { ...item, x1: item.x1 + x, x2: item.x2 + x, y1: item.y1 + y, y2: item.y2 + y };
  return { ...item, x: item.x + x, y: item.y + y };
}
/** Ordered blocks share one vertical flow; their explicit local anchors move with the same content. */
export function stack(
  contents: readonly MeasuredContent[],
  gap: number,
): MeasuredContent {
  const positioned = contents.reduce<readonly MeasuredContent[]>(
    (result, content) => appendContent(result, content, gap),
    [],
  );
  return {
    width: Math.max(0, ...contents.map((item) => item.width)),
    height: stackHeight(contents, gap),
    primitives: positioned.flatMap((item) => item.primitives),
    anchors: positioned.flatMap((item) => item.anchors),
    outline: contents.flatMap((item) => item.outline),
  };
}
/** Track intrinsic height on original blocks; positioned offsets never alter the measured extents. */
function appendContent(
  result: readonly MeasuredContent[],
  content: MeasuredContent,
  gap: number,
): readonly MeasuredContent[] {
  const y = stackHeight(result, gap) + gapBefore(result, gap);
  return [...result, offset(content, 0, y)];
}
/** No leading gap; empty composition has exactly zero height. */
function gapBefore(
  contents: readonly MeasuredContent[],
  gap: number,
): number {
  if (contents.length === 0) return 0;
  return gap;
}
/** Intrinsic heights remain additive regardless of primitive positions. */
function stackHeight(
  contents: readonly MeasuredContent[],
  gap: number,
): number {
  return (
    contents.reduce((height, item) => height + item.height, 0) +
    Math.max(0, contents.length - 1) * gap
  );
}

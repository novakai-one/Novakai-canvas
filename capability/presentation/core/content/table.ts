import type { ContentBlock } from '../../contract/records/input.js';
import type { ResolvedStyle } from '../../contract/records/style.js';
import type { Anchor, MeasuredContent } from '../../contract/records/visual.js';
import type { MeasurementPort } from '../../contract/ports/measurement.js';
import { requireValue } from '../validation/outcomes.js';
import { measureText, offset, stack } from './text.js';
interface RowInput {
  readonly id: string | null;
  readonly cells: readonly string[];
}
/** Each cell uses the same pinned mono metrics; widest row determines intrinsic table width. */
function cell(
  text: string,
  width: number,
  style: ResolvedStyle,
  metrics: MeasurementPort,
): MeasuredContent {
  return measureText(
    {
      text,
      width,
      ...style.typography.mono,
      fill: style.text,
    },
    metrics,
  );
}
/** Measured cells share a row height; its midpoint is the stable endpoint for an addressable row. */
function row(
  input: RowInput,
  widths: readonly number[],
  style: ResolvedStyle,
  metrics: MeasurementPort,
): MeasuredContent {
  const width = widths.reduce((sum, width) => sum + width, 0);
  const cells = input.cells.map((text, index) =>
    cell(text, (widths[index] ?? width) - style.padding * 2, style, metrics),
  );
  const height =
    Math.max(style.contentSizing.rowMinimum, ...cells.map((value) => value.height)) +
    style.padding * 2;
  const positioned = cells.map((value, index) =>
    offset(
      value,
      widths.slice(0, index).reduce((sum, width) => sum + width, 0) + style.padding,
      style.padding,
    ),
  );
  return {
    width,
    height,
    primitives: [
      ...positioned.flatMap((value) => value.primitives),
      {
        kind: 'rule',
        x1: 0,
        y1: height,
        x2: width,
        y2: height,
        stroke: style.border,
        width: style.stroke,
      },
    ],
    anchors: rowAnchors(input, height),
    outline: [input.cells.join(' | ')],
  };
}
/** Tables grow horizontally for readable columns; they never squeeze many headings into a fixed card width. */
export function measureTable(
  block: Extract<ContentBlock, { kind: 'table' }>,
  width: number,
  style: ResolvedStyle,
  metrics: MeasurementPort,
): MeasuredContent {
  const rows: readonly RowInput[] = [{ id: null, cells: block.columns }, ...block.rows];
  const intrinsic = block.columns.map((_, index) => columnWidth(rows, index, style, metrics));
  const extra = Math.max(0, width - intrinsic.reduce((sum, value) => sum + value, 0));
  const widths = intrinsic.map((value) => value + extra / intrinsic.length);
  return stack(
    rows.map((value) => row(value, widths, style, metrics)),
    0,
  );
}

/** Per-column intrinsic atoms preserve long identifiers while prose wraps in a readable column. */
function columnWidth(
  rows: readonly RowInput[],
  index: number,
  style: ResolvedStyle,
  metrics: MeasurementPort,
): number {
  const words = rows.flatMap((row) => (row.cells[index] ?? '').split(/\s+/u));
  const metric = style.typography.mono;
  const advances = words.map(
    (word) => requireValue(metrics.measure(word, metric.font, metric.size)).width,
  );
  return Math.max(
    style.contentSizing.widths.small.preferred,
    Math.max(0, ...advances) + style.padding * 2 + style.stroke,
  );
}

/** Header rows have no address; body rows retain canonical cell text and a measured midpoint. */
function rowAnchors(
  input: RowInput,
  height: number,
): readonly Anchor[] {
  if (input.id === null) return [];
  return [
    {
      member: input.id,
      x: 0,
      y: height / 2,
      direction: 'inout',
      collapsed: false,
      label: input.cells.join(' | '),
    },
  ];
}

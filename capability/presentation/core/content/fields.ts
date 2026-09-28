import type { ContentBlock } from '../../contract/records/input.js';
import type { ContentContext, FieldColumns } from '../../contract/records/content-context.js';
import type { MeasuredContent, Primitive } from '../../contract/records/visual.js';
import { requireValue } from '../validation/outcomes.js';
import { measureText, offset } from './text.js';
type Field = Extract<ContentBlock, { kind: 'field' }>;
type Key = Exclude<Field['key'], undefined>;
const keys: Readonly<Record<Key, string>> = { primary: 'PK', foreign: 'FK', unique: 'UQ' };
const keyOrder: readonly Key[] = ['primary', 'foreign', 'unique'];
/** Key chips borrow the theme's semantic role paints: PK is primary, FK supporting, UQ success. */
const keyRoles: Readonly<Record<Key, string>> = {
  primary: 'primary',
  foreign: 'supporting',
  unique: 'success',
};
/** Empty key cells are meaningful; key vocabulary is shared by visible text and accessible row descriptions. */
export function fieldKey(key: Field['key']): string {
  if (key === undefined) return '';
  return keys[key];
}
/** Canonical composite membership survives a view that hides the key-group summary. */
function compositeKeys(
  field: Field,
  context: ContentContext,
): readonly Key[] {
  const owner = context.owner;
  if (owner === undefined) return [];
  return owner.content
    .filter((block) => block.kind === 'keygroup')
    .filter((group) => group.fields.includes(field.id))
    .map((group) => group.key);
}
/** A field may be PK and FK together; fixed role order keeps the visible badges unambiguous. */
function fieldKeys(
  field: Field,
  context: ContentContext,
): readonly Key[] {
  const membership = [field.key, ...compositeKeys(field, context)];
  return keyOrder.filter((key) => membership.includes(key));
}
/** The accessible row description joins composite membership into one spoken key group. */
function fieldBadge(
  field: Field,
  context: ContentContext,
): string {
  return fieldKeys(field, context)
    .map((key) => keys[key])
    .join('/');
}
/** Optionality is visible without repeating the word required in every row; the full meaning remains in its accessible outline. */
function typeLabel(
  field: Field,
  context: ContentContext,
): string {
  const type =
    context.resolveFieldType?.(field) ??
    (typeof field.type === 'string' ? field.type : `@${field.type.id}`);
  return field.nullable ? `${type}?` : type;
}
/** Pinned glyph metrics are the only width source; chips and plain cells share one measurement path. */
function monoWidth(
  text: string,
  context: ContentContext,
): number {
  return requireValue(
    context.metrics.measure(
      text,
      context.style.typography.mono.font,
      context.style.typography.mono.size,
    ),
  ).width;
}
/** Chip insets stay fractions of the shared gap and stroke, so badge padding never leaves the column model. */
interface ChipPadding {
  readonly x: number;
  readonly y: number;
  readonly gap: number;
}
/** Pill insets scale with diagram density tokens rather than carrying local pixel opinions. */
function chipPadding(context: ContentContext): ChipPadding {
  return { x: context.style.gap, y: context.style.stroke * 2, gap: context.style.gap / 2 };
}
/** The key column reserves each chip's full footprint: monogram text, horizontal insets and inter-chip gaps. */
function chipsWidth(
  labels: readonly string[],
  context: ContentContext,
): number {
  if (labels.length === 0) return 0;
  const padding = chipPadding(context);
  const text = labels.reduce((total, label) => total + monoWidth(label, context), 0);
  return text + labels.length * padding.x * 2 + (labels.length - 1) * padding.gap;
}
/** Actual content widths determine column minimums; atomic identifiers retain their full width. */
function columnWidth(
  widths: readonly number[],
  context: ContentContext,
): number {
  return (
    Math.ceil(Math.max(context.style.typography.mono.size, ...widths)) +
    context.style.stroke +
    context.style.gap * 2
  );
}
/** Plain text columns measure their widest string directly. */
function column(
  values: readonly string[],
  context: ContentContext,
): number {
  return columnWidth(
    values.map((text) => monoWidth(text, context)),
    context,
  );
}
/** All fields in a node share identical column starts, producing an ER table rather than independently wrapped prose. */
export function fieldColumns(
  blocks: readonly ContentBlock[],
  context: ContentContext,
): FieldColumns {
  const fields = blocks.filter((block) => block.kind === 'field');
  return {
    key: columnWidth(
      fields.map((field) =>
        chipsWidth(
          fieldKeys(field, context).map((key) => keys[key]),
          context,
        ),
      ),
      context,
    ),
    name: column(
      fields.map((field) => `${field.label}:`),
      context,
    ),
    type: column(
      fields.map((field) => typeLabel(field, context)),
      context,
    ),
  };
}
/** Each cell is measured in its assigned column and vertically padded with diagram tokens. */
function cell(
  text: string,
  width: number,
  x: number,
  context: ContentContext,
  fill: string,
): MeasuredContent {
  const measured = measureText(
    {
      text,
      width: width - context.style.gap * 2,
      ...context.style.typography.mono,
      fill,
    },
    context.metrics,
  );
  return offset(measured, x + context.style.gap, context.style.gap);
}
interface KeyChip {
  readonly width: number;
  readonly height: number;
  readonly primitives: readonly Primitive[];
}
/** One key chip centers its monogram inside a role-painted pill on the row's shared baseline. */
function keyChip(
  key: Key,
  x: number,
  context: ContentContext,
): KeyChip {
  const padding = chipPadding(context);
  const paint = context.style.roles[keyRoles[key]];
  const text = measureText(
    {
      text: keys[key],
      width: monoWidth(keys[key], context),
      ...context.style.typography.mono,
      fill: paint?.text ?? context.style.text,
    },
    context.metrics,
  );
  const width = text.width + padding.x * 2;
  const height = text.height + padding.y * 2;
  const badge: Primitive = {
    kind: 'badge',
    role: keyRoles[key],
    x,
    y: context.style.gap - padding.y,
    width,
    height,
    radius: height / 2,
    fill: paint?.fill ?? context.style.surface,
    stroke: paint?.stroke ?? context.style.border,
    strokeWidth: context.style.stroke,
  };
  return {
    width,
    height,
    primitives: [badge, ...offset(text, x + padding.x, context.style.gap).primitives],
  };
}
/** Key chips advance left to right inside the key column; empty membership reserves the column silently. */
function keyChips(
  field: Field,
  context: ContentContext,
): Omit<KeyChip, 'width'> {
  const padding = chipPadding(context);
  const placed = fieldKeys(field, context).reduce<{
    readonly x: number;
    readonly height: number;
    readonly primitives: readonly Primitive[];
  }>(
    (state, key) => {
      const chip = keyChip(key, state.x, context);
      return {
        x: state.x + chip.width + padding.gap,
        height: Math.max(state.height, chip.height),
        primitives: [...state.primitives, ...chip.primitives],
      };
    },
    { x: context.style.gap - padding.x, height: 0, primitives: [] },
  );
  return { height: placed.height, primitives: placed.primitives };
}
/** Row anchors remain at the measured row midpoint; FK wires attach to fields while canonical data remains unchanged. */
export function measureField(
  field: Field,
  context: ContentContext,
): MeasuredContent {
  const columns = context.fields ?? fieldColumns([field], context);
  const chips = keyChips(field, context);
  const values = [
    cell(`${field.label}:`, columns.name, columns.key, context, context.style.text),
    cell(
      typeLabel(field, context),
      columns.type,
      columns.key + columns.name,
      context,
      context.style.secondary,
    ),
  ];
  const height =
    Math.max(
      context.style.contentSizing.rowMinimum,
      chips.height,
      ...values.map((value) => value.height),
    ) +
    context.style.gap * 2;
  const width = columns.key + columns.name + columns.type;
  const nullability = field.nullable ? 'nullable' : 'required';
  const label =
    `${fieldBadge(field, context)} ${field.label}: ${typeLabel(field, context).replace(/\?$/, '')} · ${nullability}`.trim();
  return {
    width,
    height,
    primitives: [
      ...chips.primitives,
      ...values.flatMap((value) => value.primitives),
      {
        kind: 'rule',
        x1: 0,
        x2: width,
        y1: height,
        y2: height,
        stroke: context.style.border,
        width: context.style.stroke,
      },
    ],
    anchors: [
      { member: field.id, x: 0, y: height / 2, direction: 'inout', collapsed: false, label },
    ],
    outline: [label],
  };
}

import type { Construct } from '../../contract/records/syntax.js';
import type { Property, ConstructDefinition } from '../../contract/records/vocabulary.js';
import type { RawRecord } from '../lowering/fields.js';
import { constructs } from '../vocabulary/constructs.js';
import { reject, origin } from '../validation/outcomes.js';
import { printValue } from './values.js';
/** Retrieve the same grammar metadata used by parsing and lowering. */
function definition(kind: Construct): ConstructDefinition {
  const value = constructs.find((item) => item.kind === kind);
  if (value === undefined)
    reject('unrepresentable', origin, 'Shipped construct', 'Unknown printable construct', kind);
  return value;
}
/** Required framing and supported property names are never redefined by individual renderers. */
export function header(
  kind: Construct,
  record: RawRecord,
): string {
  const construct = definition(kind);
  const positions = construct.positions.flatMap((rule) => position(record, rule));
  return [kind, ...positions, ...printProperties(record, construct.properties)].join(' ');
}
/** Literal arrows and optional branch IDs retain their declared framing. */
function position(
  record: RawRecord,
  rule: ConstructDefinition['positions'][number],
): readonly string[] {
  if (rule.literal !== undefined) return [rule.literal];
  if (omittedPosition(record, rule)) return [];
  return [printValue(record[rule.name], rule.type)];
}
/** Omit a default only when the lowering table restores that exact semantic value. */
export function printProperties(
  record: RawRecord,
  properties: Readonly<Record<string, Property>>,
): readonly string[] {
  return Object.entries(properties).flatMap(([name, property]) =>
    propertyText(record, name, property),
  );
}
/** Absent optional fields do not become empty strings; meaningful empty strings remain quoted. */
function propertyText(
  record: RawRecord,
  name: string,
  property: Property,
): readonly string[] {
  const value = record[property.field];
  if (value === undefined) return [];
  if (value === property.fallback) return [];
  return [`${name}=${printValue(value, property.type)}`];
}

/** Only explicitly optional framing may omit an absent positional value. */
function omittedPosition(
  record: RawRecord,
  rule: ConstructDefinition['positions'][number],
): boolean {
  return rule.optional === true && record[rule.name] === undefined;
}

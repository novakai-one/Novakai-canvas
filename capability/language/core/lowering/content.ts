/*
 * Lowering declarations to plain records: positional values and attributes (with defaults) for
 * any construct, plus the special shapes of nodes, links and tables. The construct table in the
 * vocabulary drives the mapping. No side effects. Language owns correcting the source; Authoring
 * owns commit recovery.
 */
import type { Declaration, Reference, SyntaxValue } from '../../contract/records/syntax.js';
import type { PositionRule } from '../../contract/records/vocabulary.js';
import { constructs } from '../vocabulary/constructs.js';
import { isReference } from '../parsing/value-types.js';
import { reject } from '../validation/outcomes.js';
import { field, id, text, optional, type RawRecord } from './fields.js';
import { mapDeclaredProperties, lowerValue } from './properties.js';

/**
 * Lowers a declaration's positional values (except a wire's or event's `->`) and then its
 * attributes, with defaults for attributes not written. An attribute with the same field name as
 * a positional value replaces it.
 *
 * @throws A `LanguageFault` with an `invalid-input` diagnostic for a construct not in the
 * vocabulary.
 */
export function lowerRecord(declaration: Declaration): RawRecord {
  const definition = constructs.find((item) => item.kind === declaration.kind);
  if (definition === undefined)
    reject('invalid-input', declaration.span, 'Shipped construct', 'Unknown parsed construct');
  const positions = definition.positions.filter((item) => item.name !== 'arrow');
  const entries = positions.flatMap((item) => positionEntry(declaration, item));
  return {
    ...Object.fromEntries(entries),
    ...mapDeclaredProperties(declaration.fields, definition.properties),
  };
}

/**
 * Lowers one content block, with its `kind`. A link and a table have their own shapes.
 *
 * @throws A `LanguageFault` with an `invalid-input` diagnostic for an unknown construct, or an
 * `invalid-value` diagnostic for a link whose target is missing, whose ID or label is missing or
 * malformed, or whose object target has a malformed `section`. A target that is present but not a
 * reference (for example `42`) is kept as a URI target, not rejected.
 */
export function lowerContent(declaration: Declaration): RawRecord {
  if (declaration.kind === 'link') return lowerLink(declaration);
  if (declaration.kind === 'table') return lowerTable(declaration);
  return { kind: declaration.kind, ...lowerRecord(declaration) };
}

/**
 * Lowers a node: its own record, then its content blocks and its ports, each in written order.
 *
 * @throws A `LanguageFault` from lowering the node or any child (see {@link lowerContent}).
 */
export function lowerNode(declaration: Declaration): RawRecord {
  const record = lowerRecord(declaration);
  const contentDeclarations = declaration.children.filter((item) => item.kind !== 'port');
  const content = contentDeclarations.map(lowerContent);
  const portDeclarations = declaration.children.filter((item) => item.kind === 'port');
  const ports = portDeclarations.map(lowerRecord);
  return { ...record, content, ports };
}

/** The `[name, value]` entry for one position, or none when the position was not written. */
function positionEntry(
  declaration: Declaration,
  item: PositionRule,
): readonly (readonly [string, unknown])[] {
  const value = declaration.fields[item.name];
  if (value === undefined) return [];
  return [[item.name, lowerValue(value.value, item.type)]];
}

/**
 * A link: its ID, its label, and its target. The target is classified before the ID and label
 * are read, so a target that cannot be read fails first.
 */
function lowerLink(declaration: Declaration): RawRecord {
  const value = field(declaration.fields, 'target').value;
  if (isReference(value)) return objectLink(declaration, value);
  return uriLink(declaration, value);
}

/** A link to an object: target `{ kind: 'object', id, section? }`. */
function objectLink(
  declaration: Declaration,
  value: Reference,
): RawRecord {
  return {
    kind: 'link',
    id: id(declaration.fields),
    label: text(declaration.fields, 'label'),
    target: { kind: 'object', id: value.id, ...optionalSection(declaration) },
  };
}

/** A link to quoted text: target `{ kind: 'uri', uri }`, kept as written and never opened here. */
function uriLink(
  declaration: Declaration,
  value: SyntaxValue,
): RawRecord {
  return {
    kind: 'link',
    id: id(declaration.fields),
    label: text(declaration.fields, 'label'),
    target: { kind: 'uri', uri: value },
  };
}

/** A link's `section=`, when written, as `{ section }`. */
function optionalSection(declaration: Declaration): RawRecord {
  if (declaration.fields.section === undefined) return {};
  return optional('section', id(declaration.fields, 'section'));
}

/** A table: its record, then its rows in written order. Model checks row IDs and cell counts. */
function lowerTable(declaration: Declaration): RawRecord {
  return {
    kind: 'table',
    ...lowerRecord(declaration),
    rows: declaration.children.map(lowerRecord),
  };
}

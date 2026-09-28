/*
 * Compiling a `set` or `unset` into one Model change. Fields the operation does not mention,
 * and any geometry a person placed, are kept. Layout attributes are written flat in the source
 * but stored nested (`layout` on a section, `arrangement` on the collection), and a link's
 * `target=` and `section=` are stored together in its `target` record. Pure apart from freezing
 * the change it returns (see `editProperties`). Language owns correcting the source; Authoring
 * owns commit recovery.
 */
import type { Collection } from '../../contract/ports/model.js';
import type { Operation, SyntaxValue } from '../../contract/records/syntax.js';
import type { ResolvedResources } from '../../contract/records/requests.js';
import type { Result } from '../../contract/errors.js';
import { withoutField, type RawRecord } from '../lowering/fields.js';
import { resolveTheme } from '../lowering/resources.js';
import { modeLayout } from '../lowering/layout.js';
import { partitionLayout } from '../lowering/layout-fields.js';
import { isReference } from '../parsing/value-types.js';
import { protect, reject } from '../validation/outcomes.js';
import { propertyTarget } from './property-targets.js';
import { changedProperties } from './property-values.js';

/**
 * Compiles a `set` or `unset` into one Model change.
 *
 * Steps: find the addressed record and the properties it accepts (`propertyTarget`); apply the
 * written changes (`changedProperties`); then fix the nested parts:
 * - collection: layout fields go into `arrangement`; a changed `theme` alias is resolved against
 *   the resources (a theme that was not changed keeps its pin);
 * - section: layout fields go into `layout`;
 * - link block: `target=` and `section=` update the `target` record;
 * - anything else: as changed.
 * Unsetting `layout` resets the algorithm to the default (`grid` for the collection, the
 * section mode's layout for a section); unsetting `columns` removes it.
 *
 * On success the change is deep-frozen in place, including the unchanged records it shares
 * with `collection`; pass the staged copy, never a record the caller still edits. Fails with
 * `invalid-input` for a malformed nested layout or link target, `invalid-value` for a bad
 * `section=`, theme diagnostics, the diagnostics of `propertyTarget` and `changedProperties`, or
 * `provider-failure` for any other throw.
 */
export function editProperties(
  collection: Collection,
  operation: Operation,
  resources: ResolvedResources,
): Result<RawRecord> {
  return protect(() => {
    const target = propertyTarget(collection, operation);
    const changed = changedProperties(target.record, operation, target.properties);
    const semantic = adjustNestedProperties(target.record, changed, operation, resources);
    return target.write(semantic);
  });
}

/** The collection's nested parts; otherwise a section's or a link's. */
function adjustNestedProperties(
  previous: RawRecord,
  next: RawRecord,
  operation: Operation,
  resources: ResolvedResources,
): RawRecord {
  if (operation.target === 'collection')
    return collectionProperties(previous, next, operation, resources);
  return adjustSectionOrContent(previous, next, operation);
}

/** A section's `layout`; a link block's `target`; any other record as changed. */
function adjustSectionOrContent(
  previous: RawRecord,
  next: RawRecord,
  operation: Operation,
): RawRecord {
  if (operation.target === 'section') return nestedLayout(previous, next, operation, 'layout');
  return previous.kind === 'link' ? linkProperties(previous, next, operation) : next;
}

/** The collection's `arrangement`, and its theme resolved when the change leaves it as text. */
function collectionProperties(
  previous: RawRecord,
  next: RawRecord,
  operation: Operation,
  resources: ResolvedResources,
): RawRecord {
  const layout = nestedLayout(previous, next, operation, 'arrangement');
  if (typeof next.theme !== 'string') return layout;
  return { ...layout, theme: resolveTheme(next.theme, resources, operation.span) };
}

/** A plain copy of Model's nested record; null, a non-object or an array is refused. */
function nestedRecord(
  value: unknown,
  operation: Operation,
): RawRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    reject(
      'invalid-input',
      operation.span,
      'Canonical nested record',
      'Owner supplied an invalid nested record',
    );
  return Object.fromEntries(Object.entries(value));
}

/**
 * Moves the changed layout fields into the nested record. Only fields with a value update it;
 * unsetting `columns` removes it; unsetting `layout` sets the default algorithm.
 */
function nestedLayout(
  previous: RawRecord,
  next: RawRecord,
  operation: Operation,
  field: 'layout' | 'arrangement',
): RawRecord {
  const before = nestedRecord(previous[field], operation);
  const { layout: modified, remaining } = partitionLayout(next);
  const updates = Object.fromEntries(
    Object.entries(modified).filter(([, value]) => value !== undefined),
  );
  const resetAlgorithm = operation.properties.includes('layout');
  const defaultAlgorithm = field === 'arrangement' ? 'grid' : modeLayout(String(next.mode));
  const retained = retainedColumns(before, operation);
  const layout = { ...retained, ...updates };
  const resolved = resetAlgorithm ? { ...layout, algorithm: defaultAlgorithm } : layout;
  return { ...remaining, [field]: resolved };
}

/**
 * A link's `target` record after the change: `section=` selects a section (object links only);
 * unsetting `section` removes it; otherwise the target as it is or as reassigned.
 */
function linkProperties(
  previous: RawRecord,
  next: RawRecord,
  operation: Operation,
): RawRecord {
  const target = linkTarget(previous, operation);
  const section = operation.fields.section;
  const remaining = withoutField(next, 'section');
  if (section !== undefined)
    return { ...remaining, target: withSection(target, section.value, operation) };
  if (operation.properties.includes('section'))
    return { ...remaining, target: withoutField(target, 'section') };
  return { ...remaining, target };
}

/**
 * A new `target=` replaces the link target: a reference becomes an object link that keeps the
 * old section; text becomes a URI link. Without `target=`, the old target is kept.
 */
function linkTarget(
  previous: RawRecord,
  operation: Operation,
): RawRecord {
  const assigned = operation.fields.target;
  if (assigned === undefined) return nestedRecord(previous.target, operation);
  if (isReference(assigned.value))
    return { kind: 'object', id: assigned.value.id, ...retainedSection(previous, operation) };
  return { kind: 'uri', uri: assigned.value };
}

/** Only an object link can select a section, and the section must be a reference. */
function withSection(
  target: RawRecord,
  value: SyntaxValue,
  operation: Operation,
): RawRecord {
  if (target.kind !== 'object')
    reject(
      'invalid-value',
      operation.span,
      'Object link',
      'URI links cannot select a local section',
    );
  if (!isReference(value))
    reject('invalid-value', operation.span, 'Section identity', 'Invalid link section');
  return { ...target, section: value.id };
}

/** The old target's section, kept when an object link is re-pointed; a URI never carries one. */
function retainedSection(
  previous: RawRecord,
  operation: Operation,
): RawRecord {
  const target = nestedRecord(previous.target, operation);
  if (target.section === undefined) return {};
  return { section: target.section };
}

/** Unsetting `columns` removes it; otherwise the nested layout is kept as it is. */
function retainedColumns(
  layout: RawRecord,
  operation: Operation,
): RawRecord {
  if (!operation.properties.includes('columns')) return layout;
  return withoutField(layout, 'columns');
}

/*
 * Lowering layout: a collection's or section's layout attributes and its `rank`, `align`,
 * `before` and `below` constraints become one plain layout record for Model. Nothing is written
 * except that a written `columns` value is kept by reference and frozen in place with the
 * result. Language owns correcting the source; Authoring owns commit recovery.
 */
import type {
  Declaration,
  Fields,
  SyntaxValue,
  Span,
  Reference,
} from '../../contract/records/syntax.js';
import { defaults, modeLayouts } from '../vocabulary/defaults.js';
import { isReference } from '../parsing/value-types.js';
import type { Result } from '../../contract/errors.js';
import { protect, reject } from '../validation/outcomes.js';
import { list, optional, textOr, type RawRecord } from './fields.js';

/** The declarations that are layout constraints. */
const constraintKinds = ['rank', 'align', 'before', 'below'];

/**
 * Lowers layout attributes and constraints. Missing attributes take their defaults: the
 * algorithm `fallback`, direction `right` and gap `normal`; `columns` is left out when not
 * written. Constraint targets keep their written order. A written `columns` value is kept by
 * reference, so the caller's object is frozen in place with the result.
 */
export function lowerLayout(
  fields: Fields,
  children: readonly Declaration[],
  fallback: string = 'flow',
): Result<RawRecord> {
  return protect(() => {
    const columns = optional('columns', fields.columns?.value);
    const algorithm = textOr(fields, 'layout', fallback);
    const direction = textOr(fields, 'direction', defaults.direction);
    const gap = textOr(fields, 'gap', defaults.gap);
    const constraintDeclarations = children.filter(isConstraint);
    const constraints = constraintDeclarations.map(lowerConstraint);
    return { ...columns, algorithm, direction, gap, constraints };
  });
}

/**
 * The layout algorithm a section `mode` uses by default; `flow` for an unknown mode. The table
 * is a plain object, so an inherited name is found too (`constructor` gives the `Object`
 * function).
 */
export function modeLayout(mode: string): string {
  return modeLayouts[mode] ?? 'flow';
}

/** Whether a declaration is a layout constraint (`rank`, `align`, `before` or `below`). */
function isConstraint(declaration: Declaration): boolean {
  return constraintKinds.includes(declaration.kind);
}

/** One constraint: its kind and its targets in written order. */
function lowerConstraint(declaration: Declaration): RawRecord {
  const kind = declaration.kind;
  const written = list(declaration.fields, 'targets');
  const targets = written.map((value) => lowerTarget(value, declaration.span));
  return { kind, targets };
}

/**
 * One constraint target: `{ kind: 'group' | 'section', id }` for a `group:` or `section:`
 * reference, otherwise `{ kind: 'object', id }`. It must be a reference.
 */
function lowerTarget(
  value: SyntaxValue,
  span: Span,
): RawRecord {
  if (!isReference(value))
    reject('invalid-value', span, 'Reference', 'Constraint needs reference targets');
  checkTarget(value, span);
  return { kind: value.namespace ?? 'object', id: value.id };
}

/** Rejects a target with a member or section part, which a layout constraint cannot place. */
function checkTarget(
  value: Reference,
  span: Span,
): void {
  if (value.member !== undefined || value.section !== undefined)
    reject(
      'invalid-value',
      span,
      'Plain object or explicit group/section reference',
      'Constraint target cannot select a member or section address',
      value.id,
    );
}

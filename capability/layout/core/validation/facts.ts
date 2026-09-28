import type { LinearConstraint, PlacementValue } from '../../contract/records/problem.js';
import type { Box } from '../../contract/records/geometry.js';
import { variableId } from '../constraints/compile.js';
import { overlaps } from '../geometry/intersections.js';
import { equal } from './equality.js';
import { reject } from './outcomes.js';
/** Exact identities include cardinality, so duplicate entries cannot disguise a missing source record. */
export function sameIds(
  expected: readonly string[],
  actual: readonly string[],
  path: string,
): void {
  if (!equal([...expected].toSorted(), [...actual].toSorted()))
    reject('invalid-input', path, 'Candidate identity/cardinality differs from source', actual);
}
/** Foreign measured data and semantic metadata must match the authoritative owner projection. */
export function same(
  expected: unknown,
  actual: unknown,
  path: string,
): void {
  if (!equal(expected, actual))
    reject(
      'invalid-input',
      path,
      'Candidate differs from authoritative content or geometry policy',
      [path],
    );
}
/** Evaluate declared required equations directly; no solver success/result is used as inspection evidence. */
export function equations(
  constraints: readonly LinearConstraint[],
  values: readonly PlacementValue[],
): void {
  const fields = ['x', 'y', 'width', 'height'] as const;
  const lookup = new Map(
    values.flatMap((value) =>
      fields.map((field) => [variableId(value.id, field), value.box[field]] as const),
    ),
  );
  constraints.forEach((constraint) => checkEquation(constraint, lookup));
}
/** Missing variables fail instead of silently behaving like zero. */
function contribution(
  variable: string,
  coefficient: number,
  values: ReadonlyMap<string, number>,
): number {
  const value = values.get(variable);
  if (value === undefined)
    return reject('invalid-input', variable, 'Candidate omitted a constrained variable');
  return coefficient * value;
}
/** Required inequality/equality tolerances are explicit; soft preferences are not validity requirements. */
function checkEquation(
  constraint: LinearConstraint,
  values: ReadonlyMap<string, number>,
): void {
  if (constraint.strength !== 'required') return;
  const total = constraint.terms.reduce(
    (sum, term) => sum + contribution(term.variable, term.coefficient, values),
    0,
  );
  const policies = {
    eq: Math.abs(total - constraint.constant) <= 0.000001,
    le: total <= constraint.constant + 0.000001,
    ge: total >= constraint.constant - 0.000001,
  };
  if (!policies[constraint.operator])
    reject(
      'constraint-conflict',
      constraint.id,
      'Candidate violates a required geometry constraint',
      constraint.targets,
    );
}
/** Distinct collection scopes cannot overlap, even when their internal content differs. */
export function disjoint(boxes: readonly { readonly id: string; readonly box: Box }[]): void {
  boxes.forEach((item, index) =>
    boxes.slice(index + 1).forEach((other) => nonoverlap(item, other)),
  );
}
/** Shared borders are permitted; positive interior intersection is a named conflict. */
export function nonoverlap(
  a: { readonly id: string; readonly box: Box },
  b: { readonly id: string; readonly box: Box },
): void {
  if (overlaps(a.box, b.box))
    reject('constraint-conflict', a.id, 'Candidate boxes overlap', [a.id, b.id]);
}

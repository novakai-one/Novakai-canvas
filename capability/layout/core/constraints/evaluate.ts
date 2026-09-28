import type { LinearConstraint } from '../../contract/records/problem.js';
import type { Box } from '../../contract/records/geometry.js';
import { reject } from '../validation/outcomes.js';
/** Evaluation tolerance absorbs sub-pixel solver drift without hiding genuine violations. */
const epsilon = 0.5;
const fields = ['x', 'y', 'width', 'height'] as const;
type Field = (typeof fields)[number];
/** Variable identities end with one owned geometry field; anything else is an engine defect. */
function fieldOf(variable: string): Field {
  const field = fields.find((name) => variable.endsWith(`.${name}`));
  if (field === undefined)
    return reject('engine-failed', variable, 'Constraint variable has no geometry field');
  return field;
}
/** Every evaluated variable must belong to a placed box; derivation never invents positions. */
function valueOf(
  variable: string,
  boxes: ReadonlyMap<string, Box>,
): number {
  const field = fieldOf(variable);
  const id = variable.slice(0, variable.length - field.length - 1);
  const box = boxes.get(id);
  if (box === undefined)
    return reject('engine-failed', variable, 'Constraint variable has no placed box');
  return box[field];
}
/** Operator satisfaction is closed data; a missed preference is geometry fact, not prose. */
const checks: Readonly<
  Record<LinearConstraint['operator'], (sum: number, constant: number) => boolean>
> = {
  eq: (sum, constant) => Math.abs(sum - constant) <= epsilon,
  le: (sum, constant) => sum - constant <= epsilon,
  ge: (sum, constant) => constant - sum <= epsilon,
};
function total(
  constraint: LinearConstraint,
  boxes: ReadonlyMap<string, Box>,
): number {
  return constraint.terms.reduce(
    (sum, term) => sum + term.coefficient * valueOf(term.variable, boxes),
    0,
  );
}
/** Return the compiled equations final geometry does not satisfy; satisfied hints report nothing. */
export function violated(
  constraints: readonly LinearConstraint[],
  boxes: ReadonlyMap<string, Box>,
): readonly LinearConstraint[] {
  return constraints.filter(
    (constraint) => !checks[constraint.operator](total(constraint, boxes), constraint.constant),
  );
}

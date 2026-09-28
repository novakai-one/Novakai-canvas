import type { Placement } from '../../contract/records/input.js';
import type { Box } from '../../contract/records/geometry.js';
import type {
  SolverProblem,
  Variable,
  LinearConstraint,
  Term,
} from '../../contract/records/problem.js';
import type { LayoutOptions } from '../../contract/types.js';
/** The same constraint box can represent a node, group or section without forged diagram objects. */
export interface ConstraintBox {
  readonly id: string;
  readonly parent: string | null;
  readonly minimum: { readonly width: number; readonly height: number };
  readonly headerHeight: number;
  readonly placement: Placement | null;
  readonly container: boolean;
}
export interface PositionedInput {
  readonly node: ConstraintBox;
  readonly strength: 'weak' | 'strong';
  readonly seed: Box;
}
const fields = ['x', 'y', 'width', 'height'] as const;
/** Stable variable identities carry no parsing requirement for the native solver. */
export function variableId(
  id: string,
  field: (typeof fields)[number],
): string {
  return `${id}.${field}`;
}
/** Named equation helper records all involved geometry targets for honest conflicts. */
export function equation(
  id: string,
  terms: readonly Term[],
  operator: LinearConstraint['operator'],
  constant: number,
  targets: readonly string[],
  strength: LinearConstraint['strength'],
): LinearConstraint {
  return { id, terms, operator, constant, strength, targets };
}
/** Individual terms are explicit, avoiding positional tuples in core constraint declarations. */
export function term(
  id: string,
  field: (typeof fields)[number],
  coefficient = 1,
): Term {
  return { variable: variableId(id, field), coefficient };
}
/** Locked positions are required; unlocked authored placement is a strong preference. */
function variables(item: PositionedInput): readonly Variable[] {
  const initial = initialBox(item);
  return fields.map((field) => ({
    id: variableId(item.node.id, field),
    initial: initial[field],
    strength: item.node.placement === null ? item.strength : 'strong',
  }));
}
/** Seed fills absent authored geometry; callers may already prefer a validated previous placement in seed. */
function initialBox(item: PositionedInput): Box {
  const placement = item.node.placement;
  if (placement === null) return item.seed;
  return {
    ...item.seed,
    x: placement.x,
    y: placement.y,
    width: placement.width ?? item.seed.width,
    height: placement.height ?? item.seed.height,
  };
}
/** Minimum measured content is always required, even when its outer box is allowed to grow. */
function minimum(item: PositionedInput): readonly LinearConstraint[] {
  const node = item.node;
  return [
    equation(
      `${node.id}:minimum-width`,
      [term(node.id, 'width')],
      'ge',
      node.minimum.width,
      [node.id],
      'required',
    ),
    equation(
      `${node.id}:minimum-height`,
      [term(node.id, 'height')],
      'ge',
      node.minimum.height,
      [node.id],
      'required',
    ),
  ];
}
/** Ordinary boxes retain measured width; container outer dimensions remain solver variables. */
function dimensions(item: PositionedInput): readonly LinearConstraint[] {
  if (item.node.container) return [];
  const height = Math.max(item.node.minimum.height, item.node.placement?.height ?? 0);
  return [
    equation(
      `${item.node.id}:width`,
      [term(item.node.id, 'width')],
      'eq',
      Math.max(item.node.minimum.width, item.node.placement?.width ?? 0),
      [item.node.id],
      'required',
    ),
    equation(
      `${item.node.id}:height`,
      [term(item.node.id, 'height')],
      'eq',
      height,
      [item.node.id],
      'required',
    ),
  ];
}
/** Absence of a lock is explicitly soft; locked supplied dimensions never silently grow. */
function locks(item: PositionedInput): readonly LinearConstraint[] {
  if (!item.node.placement?.locked) return [];
  const placement = item.node.placement;
  return fields.flatMap((field) => lockField(item.node, field, placement[field]));
}
/** Width/height omitted from a lock remain content-driven, not frozen to an accidental prior size. */
function lockField(
  node: ConstraintBox,
  field: (typeof fields)[number],
  value: number | undefined,
): readonly LinearConstraint[] {
  if (value === undefined) return [];
  return [
    equation(
      `${node.id}:lock-${field}`,
      lockTerms(node, field),
      'eq',
      value,
      [node.id],
      'required',
    ),
  ];
}
/** Stored positions are parent-local; solver variables and candidate boxes are section-local. */
function lockTerms(
  node: ConstraintBox,
  field: (typeof fields)[number],
): Term[] {
  const terms = [term(node.id, field)];
  if (node.parent !== null && ['x', 'y'].includes(field)) terms.push(term(node.parent, field, -1));
  return terms;
}
/** Children stay inside parent padding and below the complete measured header. */
function containment(
  item: PositionedInput,
  items: readonly PositionedInput[],
  padding: number,
): readonly LinearConstraint[] {
  const parent = items.find((other) => other.node.id === item.node.parent);
  if (!parent) return [];
  const child = item.node.id;
  const owner = parent.node.id;
  const targets = [owner, child];
  return [
    equation(
      `${child}:inside-left`,
      [term(child, 'x'), term(owner, 'x', -1)],
      'ge',
      padding,
      targets,
      'required',
    ),
    equation(
      `${child}:inside-top`,
      [term(child, 'y'), term(owner, 'y', -1)],
      'ge',
      parent.node.headerHeight + padding,
      targets,
      'required',
    ),
    equation(
      `${child}:inside-right`,
      [term(child, 'x'), term(child, 'width'), term(owner, 'x', -1), term(owner, 'width', -1)],
      'le',
      -padding,
      targets,
      'required',
    ),
    equation(
      `${child}:inside-bottom`,
      [term(child, 'y'), term(child, 'height'), term(owner, 'y', -1), term(owner, 'height', -1)],
      'le',
      -padding,
      targets,
      'required',
    ),
  ];
}
/** Compile hard content/lock/containment facts; relative constraints are appended by their own policy. */
export function compile(
  items: readonly PositionedInput[],
  options: LayoutOptions,
): SolverProblem {
  return {
    variables: items.flatMap(variables),
    constraints: items.flatMap((item) => [
      ...minimum(item),
      ...dimensions(item),
      ...locks(item),
      ...containment(item, items, options.padding),
    ]),
  };
}

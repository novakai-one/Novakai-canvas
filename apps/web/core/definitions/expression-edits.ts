/*
 * Union edits in the expression editor. Each returns a new union and never changes the one it
 * was given. A union keeps at least two alternatives, as Model requires.
 */
import type {
  ExpressionPath,
  TypeExpression,
  UnionExpression,
} from '../../contract/records/definitions.js';

/** The path of a definition's top-level expression. */
export const rootPath: ExpressionPath = [];

/** The union with the alternative at `index` replaced; the other items are kept as they are. */
export function replaceAlternative(
  union: UnionExpression,
  index: number,
  next: TypeExpression,
): UnionExpression {
  return {
    kind: 'union',
    items: union.items.map((item, position) => (position === index ? next : item)),
  };
}

/** The union with an empty string literal added at the end. */
export function addAlternative(union: UnionExpression): UnionExpression {
  return { kind: 'union', items: [...union.items, { kind: 'literal', value: '' }] };
}

/** The union without its last alternative. */
export function removeLastAlternative(union: UnionExpression): UnionExpression {
  return { kind: 'union', items: union.items.slice(0, -1) };
}

/** Whether the union can lose an alternative and still have two. */
export function canRemoveAlternative(union: UnionExpression): boolean {
  return union.items.length > 2;
}

/*
 * Expression path comparisons. A path lists the union item index at each level from the
 * expression root. The Definitions panel and the definition session share this one copy.
 */
import type { ExpressionPath } from '../../contract/records/definitions.js';

/** Whether two paths name the same expression node. */
export function samePath(
  left: ExpressionPath,
  right: ExpressionPath,
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Whether `path` is `ancestor` itself or lies inside it. */
export function isPathWithin(
  path: ExpressionPath,
  ancestor: ExpressionPath,
): boolean {
  return ancestor.length <= path.length && ancestor.every((value, index) => path[index] === value);
}

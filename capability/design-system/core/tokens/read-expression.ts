import type { Expression, TokenType } from '../../contract/records/tokens.js';
import { record, keys, text, list, depthLimit, member } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { reference } from './references.js';
import { readLiteral } from './values.js';
/** Literal or alias token values have no executable interpretation. */
export function readValueExpression(
  type: TokenType,
  value: unknown,
  path: string,
): Expression {
  const target = reference(value, path);
  if (target) return { op: 'reference', target };
  return { op: 'literal', value: readLiteral(type, value, path) };
}
/** Parse only declared recipe operators; facade owns correction and retry. */
export function readRecipe(
  value: unknown,
  path: string,
  depth = 0,
): Expression {
  depthLimit(depth, path);
  const data = record(value, path);
  const op = text(data.op, path);
  return member(recipeReaders, op)(data, path, depth + 1);
}
/** Reference recipes share the ordinary alias grammar. */
function readReference(
  data: Readonly<Record<string, unknown>>,
  path: string,
): Expression {
  keys(data, ['op', 'value'], path);
  const target = reference(data.value, path);
  if (!target)
    return reject('invalid-input', path, 'token reference', 'Recipe reference is missing');
  return { op: 'reference', target };
}
/** Multiplication accepts a separately evaluated scalar token, never an implicit unit conversion. */
function readMultiply(
  data: Readonly<Record<string, unknown>>,
  path: string,
  depth: number,
): Expression {
  keys(data, ['op', 'value', 'scalar'], path);
  return {
    op: 'multiply',
    value: readRecipe(data.value, path, depth),
    scalar: readRecipe(data.scalar, path, depth),
  };
}
/** Alpha modifies a declared color with a declared scalar. */
function readAlpha(
  data: Readonly<Record<string, unknown>>,
  path: string,
  depth: number,
): Expression {
  keys(data, ['op', 'color', 'scalar'], path);
  return {
    op: 'alpha',
    color: readRecipe(data.color, path, depth),
    scalar: readRecipe(data.scalar, path, depth),
  };
}
/** Sum/max arity is bounded before recursive interpretation. */
function readAggregate(
  op: 'sum' | 'max',
  data: Readonly<Record<string, unknown>>,
  path: string,
  depth: number,
): Expression {
  keys(data, ['op', 'values'], path);
  const values = list(data.values, path);
  if (values.length < 2 || values.length > 8)
    return reject('invalid-input', path, '2..8 operands', 'Invalid recipe arity');
  return { op, values: values.map((value) => readRecipe(value, path, depth)) };
}
/** Literal values use readValueExpression; every non-literal recipe operator must have a reader. */
const recipeReaders: Readonly<
  Record<
    Exclude<Expression['op'], 'literal'>,
    (data: Readonly<Record<string, unknown>>, path: string, depth: number) => Expression
  >
> = {
  reference: readReference,
  multiply: readMultiply,
  alpha: readAlpha,
  sum: (data, path, depth) => readAggregate('sum', data, path, depth),
  max: (data, path, depth) => readAggregate('max', data, path, depth),
};

import type { Expression, TokenValue, TokenValues } from '../../contract/records/tokens.js';
import { member, depthLimit } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { numeric, colorText, colorByte } from './values.js';
/** Interpret bounded expression data against already resolved dependencies; facade owns failure recovery. */
export function evaluate(
  expression: Expression,
  values: TokenValues,
  path: string,
  depth = 0,
): TokenValue {
  depthLimit(depth, path);
  return operations[expression.op](expression, values, path, depth + 1);
}
/** A literal needs no coercion; expression parser already validated it. */
function literal(expression: Expression): TokenValue {
  if (expression.op !== 'literal')
    return reject('type-mismatch', 'recipe', 'literal', 'Invalid dispatch');
  return expression.value;
}
/** Aliases point at an already resolved primitive. */
function reference(
  expression: Expression,
  values: TokenValues,
): TokenValue {
  if (expression.op !== 'reference')
    return reject('type-mismatch', 'recipe', 'reference', 'Invalid dispatch');
  return member(values, expression.target);
}
/** Multiplication preserves the value's unit and requires a unitless scalar. */
function multiply(
  expression: Expression,
  values: TokenValues,
  path: string,
  depth: number,
): TokenValue {
  if (expression.op !== 'multiply')
    return reject('type-mismatch', path, 'multiply', 'Invalid dispatch');
  const value = evaluate(expression.value, values, path, depth);
  const scalar = scalarValue(evaluate(expression.scalar, values, path, depth), path);
  return changedNumber(value, numeric(value, path) * scalar, path);
}
/** Sum/max reject different units even when their numeric values would happen to agree. */
function aggregate(
  expression: Expression,
  values: TokenValues,
  path: string,
  depth: number,
): TokenValue {
  if (!('values' in expression))
    return reject('type-mismatch', path, 'aggregate', 'Invalid dispatch');
  const operands = expression.values.map((value) => evaluate(value, values, path, depth));
  const first = operands[0];
  if (!first) return reject('invalid-input', path, '2..8 operands', 'No operands');
  const numbers = operands.map((value) => sameUnit(value, first, path));
  const result = aggregateNumber(expression.op, numbers);
  return changedNumber(first, result, path);
}
/** Alpha uses canonical byte rounding, including opaque hex shortening. */
function alpha(
  expression: Expression,
  values: TokenValues,
  path: string,
  depth: number,
): TokenValue {
  if (expression.op !== 'alpha') return reject('type-mismatch', path, 'alpha', 'Invalid dispatch');
  const color = colorText(evaluate(expression.color, values, path, depth), path);
  const amount = scalarValue(evaluate(expression.scalar, values, path, depth), path);
  if (amount < 0 || amount > 1)
    return reject('out-of-range', path, '0..1 alpha', 'Alpha outside bounds');
  const byte = colorByte(amount);
  return { type: 'color', value: color.slice(0, 7) + alphaSuffix(byte) };
}
/** A scalar cannot smuggle dimensions into another expression. */
function scalarValue(
  value: TokenValue,
  path: string,
): number {
  if (value.type !== 'number')
    return reject('type-mismatch', path, 'number scalar', 'Expected scalar token');
  return value.value;
}
/** Same token type implies the one supported unit for that numeric type. */
function sameUnit(
  value: TokenValue,
  first: TokenValue,
  path: string,
): number {
  if (value.type !== first.type)
    return reject('type-mismatch', path, 'matching operand units', 'Mixed-unit recipe');
  return numeric(value, path);
}
/** Rebuild a numeric primitive without unsafe narrowing or unchecked casts. */
function changedNumber(
  value: TokenValue,
  next: number,
  path: string,
): TokenValue {
  if (!Number.isFinite(next))
    return reject('out-of-range', path, 'finite recipe result', 'Recipe overflow');
  if (typeof value.value !== 'number')
    return reject('type-mismatch', path, 'numeric token', 'Nonnumeric recipe');
  return numericCopies[value.type](next);
}
const numericCopies = {
  number: (value: number): TokenValue => ({ type: 'number', value }),
  dimension: (value: number): TokenValue => ({ type: 'dimension', value, unit: 'px' }),
  duration: (value: number): TokenValue => ({ type: 'duration', value, unit: 'ms' }),
  color: (): TokenValue => reject('type-mismatch', 'recipe', 'number', 'Color is not numeric'),
  fontFamily: (): TokenValue => reject('type-mismatch', 'recipe', 'number', 'Font is not numeric'),
};
const operations: Readonly<
  Record<
    Expression['op'],
    (expression: Expression, values: TokenValues, path: string, depth: number) => TokenValue
  >
> = { literal, reference, multiply, sum: aggregate, max: aggregate, alpha };

/** The two aggregate algorithms share checked same-unit numeric operands. */
function aggregateNumber(
  op: string,
  numbers: readonly number[],
): number {
  if (op === 'sum') return numbers.reduce((a, b) => a + b, 0);
  return Math.max(...numbers);
}
/** Canonical opaque colors omit redundant alpha bytes. */
function alphaSuffix(byte: string): string {
  if (byte === 'ff') return '';
  return byte;
}

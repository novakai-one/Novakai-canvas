import type { TokenValue, TokenType } from '../../contract/records/tokens.js';
import { componentColor, dimension, duration } from '../../contract/records/validation.js';
import { list, text, number, parsed } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
/** Quantize channels before contrast, CSS and hashes; Design System owns correction. */
export function colorByte(channel: number): string {
  return Math.round(channel * 255)
    .toString(16)
    .padStart(2, '0');
}
/** Canonical hex preserves exactly the bytes accepted by Templates and Presentation. */
function colorValue(
  value: unknown,
  path: string,
): TokenValue {
  const color = parsed(componentColor, value, path);
  const rgb = color.components.map(colorByte).join('');
  const alpha = colorByte(color.alpha);
  if (alpha === 'ff') return { type: 'color', value: '#' + rgb };
  return { type: 'color', value: '#' + rgb + alpha };
}
/** Approved aliases or admitted family names remain data; CSS serialization adds quoting. */
function fontValue(
  value: unknown,
  path: string,
): TokenValue {
  const values = typeof value === 'string' ? [value] : list(value, path);
  const families = values.map((item) => text(item, path));
  if (!families.length)
    return reject('missing-font', path, 'nonempty font family', 'Font list is empty');
  families.forEach((family) => checkFamily(family, path));
  return { type: 'fontFamily', value: families };
}
/** Font strings cannot contain CSS syntax; exact approval is checked at scope resolution. */
function checkFamily(
  family: string,
  path: string,
): void {
  if (!/^[A-Za-z][A-Za-z0-9 -]{0,127}$/.test(family))
    reject('missing-font', path, 'safe approved family', 'Unsafe font family');
}
const readers: Readonly<Record<TokenType, (value: unknown, path: string) => TokenValue>> = {
  color: colorValue,
  dimension: (value, path) => ({ type: 'dimension', ...parsed(dimension, value, path) }),
  duration: (value, path) => ({ type: 'duration', ...parsed(duration, value, path) }),
  number: (value, path) => ({ type: 'number', value: number(value, path) }),
  fontFamily: fontValue,
};
/** Decode supported DTCG literal types; facade catches structured failures. */
export function readLiteral(
  type: TokenType,
  value: unknown,
  path: string,
): TokenValue {
  return readers[type](value, path);
}
/** Numeric extraction keeps dimensions and scalar recipes distinct. */
export function numeric(
  value: TokenValue,
  path: string,
): number {
  if (typeof value.value !== 'number')
    return reject('type-mismatch', path, 'numeric value', 'Expected numeric token');
  return value.value;
}
/** Require a color rather than coercing another primitive to CSS. */
export function colorText(
  value: TokenValue,
  path: string,
): string {
  if (value.type !== 'color') return reject('type-mismatch', path, 'color', 'Expected color token');
  return value.value;
}

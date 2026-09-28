import { tokenId, type TokenId } from '../../contract/brands.js';
import { parsed, record, keys, text } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
/** Alias forms address token values only; unsupported pointer fragments fail explicitly. */
export function reference(
  value: unknown,
  path: string,
): TokenId | null {
  if (typeof value === 'string') return curlyReference(value, path);
  if (Array.isArray(value)) return null;
  return objectReference(value, path);
}
/** Ordinary strings remain literals; a leading brace commits to alias syntax. */
function curlyReference(
  value: string,
  path: string,
): TokenId | null {
  if (!value.startsWith('{')) return null;
  if (!/^\{[^{}]+\}$/.test(value))
    return reject('invalid-input', path, '{token.path}', 'Malformed alias');
  return parsed(tokenId, value.slice(1, -1), path);
}
/** JSON pointers use a closed $ref object and end at $value. */
function pointerReference(
  value: object,
  path: string,
): TokenId | null {
  const fields = record(value, path);
  if (!('$ref' in fields)) return null;
  keys(fields, ['$ref'], path);
  const pointer = text(fields.$ref, path);
  if (!/^#\/(?:[A-Za-z0-9][A-Za-z0-9]*\/)+\$value$/.test(pointer))
    return reject('invalid-input', path, '#/group/token/$value', 'Unsupported JSON pointer');
  return parsed(tokenId, pointer.slice(2, -7).replaceAll('/', '.'), path);
}

/** Only object aliases enter JSON-pointer decoding; all other scalars remain literal candidates. */
function objectReference(
  value: unknown,
  path: string,
): TokenId | null {
  if (typeof value !== 'object') return null;
  if (value === null) return null;
  return pointerReference(value, path);
}

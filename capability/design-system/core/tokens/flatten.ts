import { tokenId } from '../../contract/brands.js';
import { tokenType } from '../../contract/records/validation.js';
import type { TokenDefinition, TokenType, Expression } from '../../contract/records/tokens.js';
import { record, keys, parsed, depthLimit, text } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { readRecipe, readValueExpression } from './read-expression.js';
/** Flatten supported groups; unsupported DTCG features never disappear silently. */
export function flatten(
  value: unknown,
  prefix = '',
  inherited: TokenType | null = null,
  depth = 0,
): readonly TokenDefinition[] {
  depthLimit(depth, prefix);
  const data = record(value, prefix);
  if (data.$description !== undefined) text(data.$description, prefix + '.$description');
  const type = readType(data.$type, inherited, prefix);
  if ('$value' in data) return [readToken(data, prefix, type)];
  return readGroup(data, prefix, type, depth);
}
/** Group type is inherited only when explicitly absent. */
function readType(
  value: unknown,
  inherited: TokenType | null,
  path: string,
): TokenType | null {
  if (value === undefined) return inherited;
  return parsed(tokenType, value, path);
}
/** Metadata keys are closed; child names become validated token IDs. */
function readGroup(
  data: Readonly<Record<string, unknown>>,
  prefix: string,
  type: TokenType | null,
  depth: number,
): readonly TokenDefinition[] {
  const unsupported = Object.keys(data).filter(
    (key) => key.startsWith('$') && !['$type', '$description'].includes(key),
  );
  if (unsupported.length)
    return reject('invalid-input', prefix, 'supported group metadata', 'Unsupported group feature');
  return Object.entries(data)
    .filter(([key]) => !key.startsWith('$'))
    .flatMap(([key, value]) => flatten(value, joined(prefix, key), type, depth + 1));
}
/** Preserve the hierarchy as a dot path; validated names cannot collide with CSS punctuation. */
function joined(
  prefix: string,
  key: string,
): string {
  if (!prefix) return key;
  return prefix + '.' + key;
}
/** Token extensions accept exactly the declared novakai recipe schema. */
function readToken(
  data: Readonly<Record<string, unknown>>,
  path: string,
  type: TokenType | null,
): TokenDefinition {
  keys(data, ['$type', '$value', '$description', '$extensions'], path);
  if (type === null)
    return reject('invalid-input', path, 'declared or inherited $type', 'Token type missing');
  return { id: parsed(tokenId, path, path), type, expression: tokenExpression(data, type, path) };
}
/** A recipe replaces the null placeholder value; duplicated literal/recipe authority is rejected. */
function tokenExpression(
  data: Readonly<Record<string, unknown>>,
  type: TokenType,
  path: string,
): Expression {
  if (data.$extensions === undefined) return readValueExpression(type, data.$value, path);
  const extensions = record(data.$extensions, path);
  keys(extensions, ['novakai'], path);
  const recipe = record(extensions.novakai, path);
  keys(recipe, ['recipe'], path);
  if (data.$value !== null)
    return reject(
      'invalid-input',
      path,
      'null recipe placeholder',
      'Recipe cannot also declare a literal',
    );
  return readRecipe(recipe.recipe, path);
}

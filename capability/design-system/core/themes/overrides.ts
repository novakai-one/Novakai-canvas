import type { SourceSet } from '../../contract/records/source.js';
import type { TokenDefinition, TokenValues } from '../../contract/records/tokens.js';
import { member } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
/** Override literal roots only; all semantic recipes continue deriving from those roots. */
export function changedDefinitions(
  source: SourceSet,
  overrides: TokenValues,
): readonly TokenDefinition[] {
  const known = Object.fromEntries(source.definitions.map((item) => [item.id, item]));
  Object.entries(overrides).forEach(([id, value]) => {
    const definition = member(known, id);
    if (definition.type !== value.type)
      reject('type-mismatch', id, definition.type, 'Override type differs');
  });
  return source.definitions.map((definition) => replaceLiteral(definition, overrides));
}
/** No mutation or inferred undefined patch spread; the unchanged branch retains its source record. */
function replaceLiteral(
  definition: TokenDefinition,
  overrides: TokenValues,
): TokenDefinition {
  const value = overrides[definition.id];
  if (!value) return definition;
  return { ...definition, expression: { op: 'literal', value } };
}

import type {
  TokenValue,
  TokenDefinition,
  TokenValues,
  Dependencies,
} from '../../contract/records/tokens.js';
import { member, depthLimit } from '../validation/input.js';
import { reject } from '../validation/outcomes.js';
import { evaluate } from './recipes.js';
import { dependencyGraph } from './dependencies.js';
/** Resolve one dependency level at a time; aliases cannot silently refer to absent values. */
export function resolveDefinitions(definitions: readonly TokenDefinition[]): {
  readonly values: TokenValues;
  readonly dependencies: Dependencies;
} {
  const dependencies = dependencyGraph(definitions);
  Object.values(dependencies)
    .flat()
    .forEach((target) => member(dependencies, target));
  const values = resolveReady(definitions, dependencies, {});
  return { values, dependencies };
}
/** Immutable level scheduling caps total work; no repeated recursive expansion of shared aliases. */
function resolveReady(
  pending: readonly TokenDefinition[],
  dependencies: Dependencies,
  values: TokenValues,
  depth = 0,
): TokenValues {
  depthLimit(depth, 'aliases');
  if (!pending.length) return values;
  const ready = pending.filter((definition) =>
    member(dependencies, definition.id).every((target) => target in values),
  );
  if (!ready.length)
    return reject(
      'cycle',
      pending.map((item) => item.id).join(', '),
      'acyclic aliases',
      'Token alias cycle',
    );
  const next = Object.fromEntries(
    ready.map((definition) => [definition.id, evaluateDefinition(definition, values)]),
  );
  return resolveReady(
    pending.filter((item) => !ready.includes(item)),
    dependencies,
    { ...values, ...next },
    depth + 1,
  );
}
/** Declared output type must agree with the recipe's actual primitive. */
function evaluateDefinition(
  definition: TokenDefinition,
  values: TokenValues,
): TokenValue {
  const value = evaluate(definition.expression, values, definition.id);
  if (value.type !== definition.type)
    return reject('type-mismatch', definition.id, definition.type, 'Recipe or alias type differs');
  return value;
}

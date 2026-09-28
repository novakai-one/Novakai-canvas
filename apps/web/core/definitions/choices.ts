/*
 * Checked select choices. A select reports a raw DOM string; these functions return a typed
 * expression part only when that string names one of the listed options, so no cast is needed.
 * Any other string returns null and the caller does nothing. That is the one deliberate
 * behavior tightening in the Definitions panel, and it lives only here.
 */
import type {
  Definition,
  LiteralKind,
  PrimitiveExpression,
  PrimitiveName,
  ReferenceExpression,
} from '../../contract/records/definitions.js';

/** The literal kinds, in the order the kind select lists them. */
export const literalKinds: readonly LiteralKind[] = ['string', 'number', 'boolean'];

/** The primitive a select value names; null outside the listed primitive names. */
export function chosenPrimitive(
  names: readonly PrimitiveName[],
  value: string,
): PrimitiveExpression | null {
  const name = chooseOption(names, value);
  return name === null ? null : { kind: 'primitive', name };
}

/** The reference a select value names; null when no listed definition has that ID. */
export function chosenReference(
  definitions: readonly Definition[],
  value: string,
): ReferenceExpression | null {
  const id = chooseOption(
    definitions.map((definition) => definition.id),
    value,
  );
  return id === null ? null : { kind: 'reference', id };
}

/** The literal kind a select value names; null for anything else. */
export function chosenLiteralKind(value: string): LiteralKind | null {
  return chooseOption(literalKinds, value);
}

/** The listed option equal to a DOM value, typed without a cast; null when none matches. */
function chooseOption<T extends string>(
  options: readonly T[],
  value: string,
): T | null {
  return options.find((option) => option === value) ?? null;
}

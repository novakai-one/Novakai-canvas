/*
 * How a resource command refuses: a private typed throw inside the operations, turned into a
 * ResourceResult by `guarded`, which commands.ts wraps around freeze, preparePreset and instantiate.
 * Pure; a refusal happens before any write, the owner's diagnostic is kept, and the caller corrects
 * the input and prepares again.
 * Planned: the service Result PR replaces PreparationFault and the throw with returned Results.
 */
import type {
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';

/** Owner diagnostics cross this boundary unchanged; unexpected provider faults become typed invalid-input outcomes. */
export class PreparationFault extends Error {
  /** Value-returning helpers retain the complete typed owner failure for the public Result boundary. */
  constructor(readonly diagnostic: ResourceDiagnostic) {
    super(diagnostic.message);
  }
}

/**
 * Runs one resource operation and returns any refusal as a typed outcome. A PreparationFault
 * answers its diagnostic unchanged (owner code, path and `source`); any other throw (a schema
 * decode) is `invalid-input` at `resources`. The caller corrects preparation and retries before
 * Authoring admission.
 */
export function guarded<T>(operation: () => T): ResourceResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return { ok: false, error: preparationDiagnostic(error) };
  }
}

/**
 * Returns the owner's value. Throws PreparationFault with the owner's diagnostic when the owner
 * refuses; no failed owner read is replaced by empty resources.
 */
export function accepted<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: ResourceDiagnostic },
): T {
  if (!result.ok) throw new PreparationFault(result.error);
  return result.value;
}

/** Unexpected schema failures remain distinguishable from owner failures without leaking provider details. */
function preparationDiagnostic(error: unknown): ResourceDiagnostic {
  if (error instanceof PreparationFault) return error.diagnostic;
  return {
    code: 'invalid-input',
    path: 'resources',
    message: 'Resource preparation input is invalid',
    recovery: 'Correct the named resource preparation input and prepare again.',
  };
}

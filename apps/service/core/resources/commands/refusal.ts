/*
 * How a resource command refuses, as values: an owner's diagnostic passes through unchanged (owner
 * code, path and `source`), and a malformed input is `invalid-input` at `resources`. Pure; a
 * refusal happens before any write, and the caller corrects the input and prepares again.
 */
import type {
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';

/** The recovery of every refusal that names a malformed resource preparation input. */
export const INPUT_RECOVERY = 'Correct the named resource preparation input and prepare again.';

/**
 * The refusal for input that does not decode: `invalid-input` at `resources` ("Resource
 * preparation input is invalid"). No native parser message leaks.
 */
export function invalidPreparation(): ResourceResult<never> {
  return preparationRefused(INVALID_INPUT);
}

/** The refusal carrying this diagnostic unchanged. */
export function preparationRefused(diagnostic: ResourceDiagnostic): ResourceResult<never> {
  return { ok: false, error: diagnostic };
}

/** The diagnostic of input that does not decode. */
const INVALID_INPUT: ResourceDiagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'resources',
  message: 'Resource preparation input is invalid',
  recovery: INPUT_RECOVERY,
});

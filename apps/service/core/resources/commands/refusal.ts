/*
 * Why this file exists
 *
 * Any resource command can be sent a body it can't use. For example,
 * `POST /api/v1/resources/prepare` with `{ "admission": 1, "extra": true }` fails its check. Every
 * command should answer that the same way, without passing on the parser's own message.
 *
 * This file makes that mistake (`invalid-input` at `resources`), and passes any other mistake on
 * as it is. A mistake is always found before anything is saved.
 */
import type {
  ResourceDiagnostic,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';

/** What the caller is told to do after an input mistake: fix the named input and prepare again. */
export const INPUT_RECOVERY = 'Correct the named resource preparation input and prepare again.';

/**
 * Makes the mistake for a body or value that fails its check: `invalid-input` at `resources`,
 * "Resource preparation input is invalid".
 */
export function invalidInputFailure(): ResourceResult<never> {
  return resourceFailure(INVALID_INPUT);
}

/** Answers this mistake as a failed resource command, unchanged. */
export function resourceFailure(diagnostic: ResourceDiagnostic): ResourceResult<never> {
  return { ok: false, error: diagnostic };
}

/** The diagnostic of input that does not decode. */
const INVALID_INPUT: ResourceDiagnostic = Object.freeze({
  code: 'invalid-input',
  path: 'resources',
  message: 'Resource preparation input is invalid',
  recovery: INPUT_RECOVERY,
});

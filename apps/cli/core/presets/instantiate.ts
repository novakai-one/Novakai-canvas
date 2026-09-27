/*
 * `recipe instantiate`: expand a pinned recipe under a namespace into editable DSL. Read-only; the
 * service does the expansion and nothing is written to the workspace. Failures are returned as
 * values; the caller fixes the pin or namespace and runs the command again.
 */
import type { ExpansionRequest } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { resourceCall } from '../resources/stage.js';
import type { ResourcePoster } from '../resources/stage.js';

/**
 * Recipe expansion is read-only and returns ordinary pinned DSL; dispatch owns explicit --out file
 * output. Fails as the service call does, or with `invalid-response` when the answer is not text.
 */
export async function instantiateRecipe(
  expansion: ExpansionRequest,
  dependencies: ResourcePoster,
): Promise<Result<string>> {
  const result = await resourceCall('instantiate', expansion, dependencies);
  if (!result.ok) return result;
  return expandedSource(result.value);
}
/** Expansion output is semantic text, never unchecked structured authoring input. */
function expandedSource(value: unknown): Result<string> {
  if (typeof value !== 'string')
    return failure({
      code: 'invalid-response',
      message: 'Recipe expansion did not return editable DSL',
    });
  return success(value);
}

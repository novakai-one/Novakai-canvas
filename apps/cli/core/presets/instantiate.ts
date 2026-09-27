/*
 * `recipe instantiate`: expand a pinned recipe under a namespace into editable DSL. Read-only; the
 * service does the expansion and nothing is written to the workspace. Failures are returned as
 * values; the caller fixes the pin or namespace and runs the command again.
 */
import type { Command } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure, success } from '../../contract/errors.js';
import { resourceCall } from '../resources/stage.js';

/** Recipe expansion is read-only and returns ordinary pinned DSL; execute owns explicit --out file output. */
export async function instantiateRecipe(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const request = dependencies.presets.expansion(command.target, command.preset?.namespace ?? '');
  if (!request.ok) return request;
  const result = await resourceCall('instantiate', request.value, dependencies);
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

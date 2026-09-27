/*
 * Service command routing: run the one flow each command names, then return its text or write the
 * text to the --out file. Uses injected ports only. Failures are returned as values;
 * `cli/canvas.ts` prints them and sets the exit code.
 */
import type { ServiceCommand } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { FilePath, RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import { instantiateRecipe } from '../presets/instantiate.js';
import { author } from '../authoring/submit.js';
import { retry } from '../authoring/reconcile.js';
import { describe, inspectPath, query, receiptPath, sourcePath } from '../reads/queries.js';
import { unsupported } from '../shared/results.js';

/**
 * Runs one service command and returns its text, or `Written: FILE` after writing --out. Fails as
 * the command's flow does, or with `output-unavailable` after the command ran.
 */
export async function execute(
  command: ServiceCommand,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const outcome = await run(command, dependencies);
  if (!outcome.ok) return outcome;
  return output(command.out, outcome.value, dependencies);
}

/** The one flow each command names; retry and apply replay the retained request after a receipt lookup. */
function run(
  command: ServiceCommand,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  switch (command.name) {
    case 'describe':
      return query('/api/v1/language', describe, dependencies);
    case 'list':
      return query('/api/v1/workspace', dependencies.semantic.collections, dependencies);
    case 'read':
      return query(
        sourcePath(command.collection, command.scope),
        dependencies.semantic.readout,
        dependencies,
      );
    case 'inspect':
      return query(inspectPath(command.collection), describe, dependencies);
    case 'receipt':
      return lookup(command.request, dependencies);
    case 'create':
    case 'replace':
    case 'patch':
    case 'preview':
      return author(command, dependencies);
    case 'retry':
    case 'apply':
      return retry(command.request, dependencies);
    case 'theme-admit':
    case 'recipe-admit':
      return admitPreset(command, dependencies);
    case 'recipe-instantiate':
      return instantiateRecipe(command.expansion, dependencies);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/** `receipt`: a missing receipt is information, not a failure. */
function lookup(
  request: RequestId,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  return query(
    receiptPath(request),
    (input) => dependencies.semantic.receipt(input, { kind: 'lookup', request }),
    dependencies,
  );
}

/** Source files are only written at the explicit --out path; stdout remains the default. */
async function output(
  path: FilePath | undefined,
  text: string,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (path === undefined) return success(text);
  const saved = await dependencies.files.writeOutput(path, text);
  if (!saved.ok) return saved;
  return success(`Written: ${path}`);
}

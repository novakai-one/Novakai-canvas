/*
 * Command routing: run the one flow each command names, then return its text or write the text to
 * the --out file. Uses injected ports only. Failures are returned as values; `cli/canvas.ts` prints
 * them and sets the exit code.
 */
import { usage } from './help.js';
import type { Command, CommandName } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import { instantiateRecipe } from '../presets/instantiate.js';
import { author } from '../authoring/submit.js';
import { retry } from '../authoring/reconcile.js';
import { executeProfile } from '../profiles/commands.js';
import { describe, query, sourcePath } from '../reads/queries.js';

/** Commands share stable transport/files/semantic roles; retry and apply replay the retained envelope after receipt lookup. */
export async function execute(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (
    command.name === 'profile-describe' ||
    command.name === 'profile-scaffold' ||
    command.name === 'profile-lint'
  )
    return executeProfile(command, { files: dependencies.files, semantic: dependencies.semantic });
  const operations: Record<CommandName, () => Promise<Result<string>>> = {
    'theme-admit': () => admitPreset(command, dependencies),
    'recipe-admit': () => admitPreset(command, dependencies),
    'recipe-instantiate': () => instantiateRecipe(command, dependencies),
    help: async () => ({ ok: true, value: usage }),
    describe: () => query('/api/v1/language', describe, dependencies),
    list: () => query('/api/v1/workspace', dependencies.semantic.collections, dependencies),
    read: () => query(sourcePath(command), dependencies.semantic.readout, dependencies),
    receipt: () =>
      query(
        `/api/v1/receipt?id=${encodeURIComponent(command.target)}`,
        (input) =>
          dependencies.semantic.receipt(input, { kind: 'lookup', request: command.target }),
        dependencies,
      ),
    inspect: () =>
      query(`/api/v1/inspect?id=${encodeURIComponent(command.target)}`, describe, dependencies),
    create: () => author(command, dependencies),
    replace: () => author(command, dependencies),
    patch: () => author(command, dependencies),
    preview: () => author(command, dependencies),
    retry: () => retry(command, dependencies),
    apply: () => retry(command, dependencies),
    'profile-describe': () =>
      executeProfile(command, { files: dependencies.files, semantic: dependencies.semantic }),
    'profile-scaffold': () =>
      executeProfile(command, { files: dependencies.files, semantic: dependencies.semantic }),
    'profile-lint': () =>
      executeProfile(command, { files: dependencies.files, semantic: dependencies.semantic }),
  };
  const outcome = await operations[command.name]();
  if (!outcome.ok) return outcome;
  return output(command.output, outcome.value, dependencies);
}

/** Source files are only written at the explicit --out path; stdout remains the default. */
async function output(
  path: string | null,
  text: string,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (path === null) return { ok: true, value: text };
  const saved = await dependencies.files.output(path, text);
  if (!saved.ok) return saved;
  return { ok: true, value: `Written: ${path}` };
}

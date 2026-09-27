import { usage } from './help.js';
import type { Command, CommandName } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { admitPreset, instantiateRecipe } from '../presets/admit.js';
import { author, retry } from '../authoring/submit.js';
import { executeProfile } from '../profiles/commands.js';
/** Read failures preserve the service diagnostic; successful payloads still pass their owner-specific readout. */
async function query(
  path: string,
  format: (input: unknown) => Result<string>,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const result = await dependencies.transport.get(path);
  if (!result.ok) return result;
  if (!result.value.outcome.ok) return result.value.outcome;
  return format(result.value.outcome.value);
}
/** Read-only grammar inspection is JSON output, never a requirement to author diagram JSON. */
function describe(value: unknown): Result<string> {
  return { ok: true, value: JSON.stringify(value, null, 2) };
}
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

function sourcePath(command: Command): string {
  const query = new URLSearchParams({ id: command.target });
  if (command.scope?.kind === 'section') query.set('section', command.scope.id);
  if (command.scope?.kind === 'object') query.set('object', command.scope.id);
  return `/api/v1/source?${query.toString()}`;
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

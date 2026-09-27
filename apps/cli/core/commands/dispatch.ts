/*
 * Service command routing: run the one flow each command names, then return its text or write the
 * text to the --out file. Uses injected ports only. Failures are returned as values;
 * `cli/canvas.ts` prints them and sets the exit code.
 */
import type { ServiceCommand } from '../../contract/records/command.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { FilePath } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { admitPreset } from '../presets/admit.js';
import type { AdmitDependencies } from '../presets/admit.js';
import { author } from '../authoring/submit.js';
import type { AuthorDependencies } from '../authoring/submit.js';
import { retry } from '../authoring/reconcile.js';
import type { RetryDependencies } from '../authoring/reconcile.js';
import { describe, inspect, list, read, receipt } from '../reads/queries.js';
import type { ReadDependencies } from '../reads/queries.js';
import { unsupported } from '../shared/results.js';

/** What routing itself uses: recipe expansion and the --out write. */
interface RouteDependencies {
  readonly resources: Pick<ServiceResources, 'instantiate'>;
  readonly files: Pick<LocalFiles, 'writeOutput'>;
}

/**
 * Every port a service command may use: each flow's own slice, joined. Compose binds each member
 * once.
 */
export type ServicePorts = ReadDependencies &
  AuthorDependencies &
  RetryDependencies &
  AdmitDependencies &
  RouteDependencies;

/**
 * Runs one service command and returns its text, or `Written: FILE` after writing --out. Fails as
 * the command's flow does, or with `output-unavailable` after the command ran.
 */
export async function executeService(
  command: ServiceCommand,
  dependencies: ServicePorts,
): Promise<Result<string>> {
  const outcome = await run(command, dependencies);
  if (!outcome.ok) return outcome;
  return output(command.out, outcome.value, dependencies);
}

/** The one flow each command names; retry and apply replay the retained request after a receipt lookup. */
function run(
  command: ServiceCommand,
  dependencies: ServicePorts,
): Promise<Result<string>> {
  switch (command.name) {
    case 'describe':
      return describe(dependencies);
    case 'list':
      return list(dependencies);
    case 'read':
      return read(command.collection, command.scope, dependencies);
    case 'inspect':
      return inspect(command.collection, dependencies);
    case 'receipt':
      return receipt(command.request, dependencies);
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
      return dependencies.resources.instantiate(command.expansion);
    default:
      return Promise.resolve(unsupported(command));
  }
}

/** Source files are only written at the explicit --out path; stdout remains the default. */
async function output(
  path: FilePath | undefined,
  text: string,
  dependencies: RouteDependencies,
): Promise<Result<string>> {
  if (path === undefined) return success(text);
  const saved = await dependencies.files.writeOutput(path, text);
  if (!saved.ok) return saved;
  return success(`Written: ${path}`);
}

import type { Command } from '../../contract/records/command.js';
import type { CliDependencies } from '../../contract/ports/runtime.js';
import type { Result } from '../../contract/errors.js';
import { failure } from '../../contract/errors.js';
import { resourceCall, stageResources } from '../resources/stage.js';
import { submit } from '../authoring/submit.js';
/** All bytes and exact preset content are retained before the sole canonical Authoring apply gate. */
export async function admitPreset(
  command: Command,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.source(command.target);
  if (!source.ok) return source;
  const parsed = dependencies.presets.source(command, source.value);
  if (!parsed.ok) return parsed;
  return stagePreset(command, parsed.value, dependencies);
}
/** Byte admission settles before immutable Templates preparation. */
async function stagePreset(
  command: Command,
  parsed: {
    readonly admission: unknown;
    readonly resources: readonly import('../../contract/records/resources.js').ResourceRequest[];
  },
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const staged = await stageResources(command.target, parsed.resources, dependencies);
  if (!staged.ok) return staged;
  const assets = staged.value.map((item) => ({ alias: item.alias, digest: item.backup.digest }));
  const prepared = await resourceCall(
    'prepare',
    { admission: parsed.admission, assets },
    dependencies,
  );
  if (!prepared.ok) return prepared;
  return retain(
    command,
    prepared.value,
    assets,
    staged.value.map((item) => item.backup),
    dependencies,
  );
}
/** Observe write preconditions after staging; the service still recomputes content and compares all reads during admission. */
async function retain(
  command: Command,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: string }[],
  backups: readonly import('../../contract/records/resources.js').ByteBackup[],
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  if (!current.value.outcome.ok) return current.value.outcome;
  return retainedSnapshot(command, prepared, assets, backups, current.value, dependencies);
}
/** Checked snapshot versions and local backups form one retained request. */
async function retainedSnapshot(
  command: Command,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: string }[],
  backups: readonly import('../../contract/records/resources.js').ByteBackup[],
  current: import('../../contract/records/foreign.js').TransportResponse,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (!current.outcome.ok) return current.outcome;
  const snapshot = dependencies.semantic.snapshot(current.outcome.value);
  if (!snapshot.ok) return snapshot;
  return retainRequest(
    command,
    prepared,
    assets,
    backups,
    snapshot.value,
    current.generation,
    dependencies,
  );
}
/** Request identity and preconditions are validated before durable local retention. */
async function retainRequest(
  command: Command,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: string }[],
  backups: readonly import('../../contract/records/resources.js').ByteBackup[],
  snapshot: import('../../contract/records/foreign.js').Snapshot,
  generation: string,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const request = dependencies.presets.request(
    prepared,
    snapshot,
    command.request ?? dependencies.nextRequestId(),
    assets,
  );
  if (!request.ok) return request;
  return submit({ generation, request: request.value, backups }, false, dependencies);
}
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
    return failure('invalid-response', 'Recipe expansion did not return editable DSL');
  return { ok: true, value };
}

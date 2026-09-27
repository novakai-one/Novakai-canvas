/*
 * `theme admit` and `recipe admit`: parse the preset file, stage its resource bytes, prepare the
 * preset through the service, then submit one retained Authoring request. Uses injected ports only.
 * Authoring owns the commit; the retained request file is the recovery record for `retry`.
 */
import type { AdmitCommand } from '../../contract/records/command.js';
import type { CliDependencies, ServiceAnswer } from '../../contract/ports/runtime.js';
import type { ByteBackup, ResourceRequest } from '../../contract/records/resources.js';
import type { Snapshot } from '../../contract/records/foreign.js';
import type { AssetDigest, FilePath, Generation } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { rejected } from '../../contract/errors.js';
import { resourceCall, stageResources } from '../resources/stage.js';
import { submit } from '../authoring/submit.js';

/** All bytes and exact preset content are retained before the sole canonical Authoring apply gate. */
export async function admitPreset(
  command: AdmitCommand,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.source(command.file);
  if (!source.ok) return source;
  const parsed = dependencies.presets.source(command, source.value.source);
  if (!parsed.ok) return parsed;
  return stagePreset(command, source.value.file, parsed.value, dependencies);
}
/** Byte admission, relative to the preset file, settles before immutable Templates preparation. */
async function stagePreset(
  command: AdmitCommand,
  file: FilePath,
  parsed: {
    readonly admission: unknown;
    readonly resources: readonly ResourceRequest[];
  },
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const staged = await stageResources(file, parsed.resources, dependencies);
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
  command: AdmitCommand,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: AssetDigest }[],
  backups: readonly ByteBackup[],
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  if (!current.value.outcome.ok) return rejected('service-rejected', current.value.outcome.error);
  return retainedSnapshot(command, prepared, assets, backups, current.value, dependencies);
}
/** Checked snapshot versions and local backups form one retained request. */
async function retainedSnapshot(
  command: AdmitCommand,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: AssetDigest }[],
  backups: readonly ByteBackup[],
  current: ServiceAnswer,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  if (!current.outcome.ok) return rejected('service-rejected', current.outcome.error);
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
  command: AdmitCommand,
  prepared: unknown,
  assets: readonly { readonly alias: string; readonly digest: AssetDigest }[],
  backups: readonly ByteBackup[],
  snapshot: Snapshot,
  generation: Generation,
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

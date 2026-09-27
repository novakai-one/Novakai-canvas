/*
 * `theme admit` and `recipe admit`: parse the preset file, stage its resource bytes, prepare the
 * preset through the service, then submit one retained Authoring request. Uses injected ports only.
 * Authoring owns the commit; the retained request file is the recovery record for `retry`.
 */
import type { AdmitCommand } from '../../contract/records/command.js';
import type { CliDependencies, PresetSource } from '../../contract/ports/runtime.js';
import type { StagedBackup } from '../../contract/records/staged-resource.js';
import type { Request } from '../../contract/records/foreign.js';
import type { Result } from '../../contract/errors.js';
import { assetBindings, resourceCall, stageResources } from '../resources/stage.js';
import { submit } from '../authoring/submit.js';

/** All bytes and exact preset content are retained before the sole canonical Authoring apply gate. */
export async function admitPreset(
  command: AdmitCommand,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) return source;
  const parsed = dependencies.presets.source(command, source.value);
  if (!parsed.ok) return parsed;
  return stagePreset(command, parsed.value, dependencies);
}
/** Byte admission, relative to the preset file, settles before immutable Templates preparation. */
async function stagePreset(
  command: AdmitCommand,
  parsed: PresetSource,
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const staged = await stageResources(command.file, parsed.resources, dependencies);
  if (!staged.ok) return staged;
  const prepared = await resourceCall(
    'prepare',
    { admission: parsed.admission, assets: assetBindings(staged.value) },
    dependencies,
  );
  if (!prepared.ok) return prepared;
  return retain(command, prepared.value, staged.value, dependencies);
}
/** Observe write preconditions after staging; the service still recomputes content and compares all reads during admission. */
async function retain(
  command: AdmitCommand,
  prepared: unknown,
  staged: readonly StagedBackup[],
  dependencies: CliDependencies,
): Promise<Result<string>> {
  const current = await dependencies.transport.get('/api/v1/workspace');
  if (!current.ok) return current;
  const request = presetRequest(command, prepared, staged, current.value.value, dependencies);
  if (!request.ok) return request;
  const backups = staged.map((item) => item.backup);
  return submit(
    { generation: current.value.generation, request: request.value, backups },
    false,
    dependencies,
  );
}
/** Request identity and preconditions are validated before durable local retention. */
function presetRequest(
  command: AdmitCommand,
  prepared: unknown,
  staged: readonly StagedBackup[],
  workspace: unknown,
  dependencies: CliDependencies,
): Result<Request> {
  const snapshot = dependencies.semantic.snapshot(workspace);
  if (!snapshot.ok) return snapshot;
  return dependencies.presets.request(
    prepared,
    snapshot.value,
    command.request ?? dependencies.nextRequestId(),
    assetBindings(staged),
  );
}

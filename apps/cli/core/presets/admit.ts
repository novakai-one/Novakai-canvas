/*
 * `theme admit` and `recipe admit`: parse the preset file, stage its resource bytes, prepare the
 * preset through the service, then submit one retained Authoring request. Uses injected ports only.
 * Authoring owns the commit; the retained request file is the recovery record for `retry`.
 */
import type { AdmitCommand } from '../../contract/records/command.js';
import type { PresetInputs, PresetSource } from '../../contract/ports/runtime.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { StagedBackup } from '../../contract/records/staged-resource.js';
import type { PresetPreparation } from '../../contract/records/service-answers.js';
import type { RequestId } from '../../contract/brands.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { assetBindings, stageResources } from '../resources/stage.js';
import type { StagingDependencies } from '../resources/stage.js';
import { submit } from '../authoring/submit.js';
import type { SubmitDependencies } from '../authoring/submit.js';

/**
 * What admission uses: the preset file read and grammar, staging, Templates preparation, the
 * workspace read, request IDs, and what `submit` uses.
 */
export interface AdmitDependencies extends StagingDependencies, SubmitDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly presets: PresetInputs;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'prepare' | 'restore'>;
  nextRequestId(): RequestId;
}

/** A preset whose bytes are staged and whose content Templates prepared. */
interface PreparedPreset {
  readonly staged: readonly StagedBackup[];
  readonly preparation: PresetPreparation;
}

/**
 * All bytes and exact preset content are retained before the sole canonical Authoring apply gate.
 * Fails as the source read, the preset grammar, staging, preparation, the workspace read, the
 * request builder or `submit` does.
 */
export async function admitPreset(
  command: AdmitCommand,
  dependencies: AdmitDependencies,
): Promise<Result<string>> {
  const parsed = await readPreset(command, dependencies);
  if (!parsed.ok) return parsed;
  const prepared = await preparePreset(command, parsed.value, dependencies);
  if (!prepared.ok) return prepared;
  return retain(command, prepared.value, dependencies);
}

/** The preset file's admission and declarations. Fails as the source read or the grammar does. */
async function readPreset(
  command: AdmitCommand,
  dependencies: AdmitDependencies,
): Promise<Result<PresetSource>> {
  const source = await dependencies.files.readSource(command.file);
  if (!source.ok) return source;
  return dependencies.presets.source(command, source.value);
}

/** Byte admission, relative to the preset file, settles before immutable Templates preparation. */
async function preparePreset(
  command: AdmitCommand,
  parsed: PresetSource,
  dependencies: AdmitDependencies,
): Promise<Result<PreparedPreset>> {
  const staged = await stageResources(command.file, parsed.resources, dependencies);
  if (!staged.ok) return staged;
  const preparation = await dependencies.resources.prepare(
    parsed.admission,
    assetBindings(staged.value),
  );
  if (!preparation.ok) return preparation;
  return success({ staged: staged.value, preparation: preparation.value });
}

/** Observe write preconditions after staging; the service still recomputes content and compares all reads during admission. */
async function retain(
  command: AdmitCommand,
  prepared: PreparedPreset,
  dependencies: AdmitDependencies,
): Promise<Result<string>> {
  const current = await dependencies.reads.workspace();
  if (!current.ok) return current;
  const request = dependencies.presets.request(
    prepared.preparation,
    current.value.value,
    command.request ?? dependencies.nextRequestId(),
    assetBindings(prepared.staged),
  );
  if (!request.ok) return request;
  const backups = prepared.staged.map((item) => item.backup);
  return submit(
    { generation: current.value.generation, request: request.value, backups },
    'apply',
    dependencies,
  );
}

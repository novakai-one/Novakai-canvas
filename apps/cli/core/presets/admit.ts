/*
 * `theme admit` and `recipe admit`: read the preset file, stage its resource bytes, prepare the
 * preset through the service, then submit one retained Authoring request. Uses injected ports only.
 * Authoring owns the commit; the retained request file is the recovery record for `retry`.
 */
import type { AdmitCommand } from '../../contract/records/command.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { SourceLanguage } from '../../contract/ports/source-language.js';
import type { Admission, ResourceRequest, Snapshot } from '../../contract/records/foreign.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { StagedBackup } from '../../contract/records/staged-resource.js';
import type { Observed, PresetPreparation } from '../../contract/records/service-answers.js';
import type { ThemeSource } from '../../contract/records/theme-source.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { assetBindings, stageResources } from '../resources/stage.js';
import type { StagingDependencies } from '../resources/stage.js';
import { submit } from '../authoring/submit.js';
import type { SubmitDependencies } from '../authoring/submit.js';
import { presetRequest } from '../authoring/preset-request.js';
import { requestIdFor } from '../authoring/envelope.js';
import { readThemeSource } from '../themes/grammar.js';
import { mapped, unsupported } from '../shared/results.js';
import { recipeSource } from './recipe-admission.js';

/**
 * What admission uses: the preset file read, the parser, staging, Templates preparation, the
 * workspace read, request IDs, and what `submit` uses.
 */
export interface AdmitDependencies extends StagingDependencies, SubmitDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly language: SourceLanguage;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'prepare' | 'restore'>;
  readonly requestIds: RequestIds;
}

/** A preset file's Templates admission and the font or image declarations to stage first. */
interface PresetSource {
  readonly admission: Admission;
  readonly resources: readonly ResourceRequest[];
}

/** A preset whose bytes are staged and whose content Templates prepared. */
interface PreparedPreset {
  readonly staged: readonly StagedBackup[];
  readonly preparation: PresetPreparation;
}

/**
 * All bytes and exact preset content are retained before the sole canonical Authoring apply gate.
 * Fails as the source read, the preset file's grammar, staging, preparation, the workspace read,
 * the fresh request ID, the preset request or `submit` does.
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
  return presetSource(command, source.value, dependencies.language);
}

/**
 * A `.theme` file through the theme grammar; a recipe through Language. Fails with
 * `invalid-theme` or `duplicate-token` (theme), or `invalid-source` (recipe).
 */
function presetSource(
  command: AdmitCommand,
  text: string,
  language: SourceLanguage,
): Result<PresetSource> {
  switch (command.name) {
    case 'theme-admit':
      return mapped(readThemeSource(text), themeSource);
    case 'recipe-admit':
      return recipeSource(command.recipe, text, language);
    default:
      return unsupported(command);
  }
}

/** A theme's admission, with its three fonts as the declarations to stage. */
function themeSource(theme: ThemeSource): PresetSource {
  return { admission: theme.admission, resources: theme.fonts };
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

/**
 * Observe write preconditions after staging; the service still recomputes content and compares all
 * reads during admission. Fails as the workspace read, {@link retainedPreset} or `submit` does.
 */
async function retain(
  command: AdmitCommand,
  prepared: PreparedPreset,
  dependencies: AdmitDependencies,
): Promise<Result<string>> {
  const current = await dependencies.reads.workspace();
  if (!current.ok) return current;
  const retained = retainedPreset(command, prepared, current.value, dependencies.requestIds);
  if (!retained.ok) return retained;
  return submit(retained.value, 'apply', dependencies);
}

/**
 * The preset's Authoring request under `--request` or a fresh ID, observed against `current`,
 * with the staged byte backups. Fails as the fresh request ID or the preset request does.
 */
function retainedPreset(
  command: AdmitCommand,
  prepared: PreparedPreset,
  current: Observed<Snapshot>,
  requestIds: RequestIds,
): Result<RetainedRequest> {
  const requestId = requestIdFor(command, requestIds);
  if (!requestId.ok) return requestId;
  const draft = {
    preparation: prepared.preparation,
    assets: assetBindings(prepared.staged),
    request: requestId.value,
  };
  const request = presetRequest(draft, current.value);
  if (!request.ok) return request;
  const backups = prepared.staged.map((item) => item.backup);
  return success({ generation: current.generation, request: request.value, backups });
}

/*
 * Why this file exists
 *
 * An agent can save a theme or recipe for reuse, as in `theme admit brand.theme`. Templates calls
 * a saved theme or recipe a preset. The save needs care: the fonts and images the file names must
 * be stored in the service first, and the request must be kept so `retry` can send it again.
 *
 * This file runs the save: read the file, store its fonts and images, have the service prepare the
 * preset, then send it to Authoring. It never saves the preset itself; Authoring does. Each step
 * gives back a `Result` (see `contract/errors.ts`).
 */
import type { AdmitCommand } from '../../contract/records/command.js';
import type { FilePath, RequestId } from '../../contract/brands.js';
import type { LocalFiles } from '../../contract/ports/local-files.js';
import type { RequestIds } from '../../contract/ports/request-ids.js';
import type { ServiceReads } from '../../contract/ports/service-reads.js';
import type { ServiceResources } from '../../contract/ports/service-resources.js';
import type { SourceParser } from '../../contract/ports/source-parser.js';
import type { ThemeReader } from '../../contract/ports/theme-reader.js';
import type {
  Admission,
  ResourceRequest,
  WorkspaceSnapshot,
} from '../../contract/records/foreign.js';
import type { RetainedRequest } from '../../contract/records/retained-request.js';
import type { StagedBackup } from '../../contract/records/staged-resource.js';
import type { ServiceAnswer, PresetPreparation } from '../../contract/records/service-answers.js';
import type { Result } from '../../contract/errors.js';
import { success } from '../../contract/errors.js';
import { listNamedAssetDigests, stageResources } from '../resources/stage.js';
import type { StagingDependencies } from '../resources/stage.js';
import { submitRequest } from '../authoring/submit.js';
import type { SubmitDependencies } from '../authoring/submit.js';
import { buildPresetRequest } from '../authoring/preset-request.js';
import type { PresetDraft } from '../authoring/preset-request.js';
import { chooseRequestId } from '../authoring/request-id.js';
import { unsupported } from '../shared/results.js';
import { parseRecipe } from './recipe-admission.js';

/**
 * The tools saving a preset uses: those for staging and sending, plus `files` (reads the file),
 * `language` or `themeReader` (parses it), `reads` and `resources` (the service), `requestIds`.
 */
export interface AdmitDependencies extends StagingDependencies, SubmitDependencies {
  readonly files: Pick<LocalFiles, 'readSource'>;
  readonly language: SourceParser;
  readonly themeReader: ThemeReader;
  readonly reads: Pick<ServiceReads, 'workspace'>;
  readonly resources: Pick<ServiceResources, 'stage' | 'blob' | 'prepare' | 'restore'>;
  readonly requestIds: RequestIds;
}

/** A parsed preset file: the preset to save, and the fonts and images it names, to store first. */
interface PresetSource {
  readonly admission: Admission;
  readonly resources: readonly ResourceRequest[];
}

/** A preset ready to send: its stored fonts and images, and the preset the service prepared. */
interface PreparedPreset {
  readonly staged: readonly StagedBackup[];
  readonly preparation: PresetPreparation;
}

/**
 * Saves a theme or recipe file for reuse, and gives back the receipt to print.
 * `theme admit brand.theme` reads the theme, stores its three fonts, then sends the save.
 * The mistakes it can find: a file that can't be read or parsed, a font or image that can't be
 * stored, a preset the service won't prepare, or a send that fails (see `submitRequest`).
 */
export async function admitPreset(
  command: AdmitCommand,
  dependencies: AdmitDependencies,
): Promise<Result<string>> {
  const presetSource = await readPresetSource(command, dependencies);
  if (!presetSource.ok) {
    return presetSource;
  }
  const prepared = await preparePreset(command.file, presetSource.value, dependencies);
  if (!prepared.ok) {
    return prepared;
  }
  return sendPreset(command, prepared.value, dependencies);
}

/** Reads the preset file, then parses its text as a theme or a recipe. */
async function readPresetSource(
  command: AdmitCommand,
  dependencies: AdmitDependencies,
): Promise<Result<PresetSource>> {
  const presetText = await dependencies.files.readSource(command.file);
  if (!presetText.ok) {
    return presetText;
  }
  return parsePresetText(command, presetText.value, dependencies);
}

/** Parses the file's text: a theme with Templates' theme reader, a recipe with Language. */
function parsePresetText(
  command: AdmitCommand,
  presetText: string,
  readers: Pick<AdmitDependencies, 'language' | 'themeReader'>,
): Result<PresetSource> {
  switch (command.name) {
    case 'theme-admit':
      return parseTheme(presetText, readers.themeReader);
    case 'recipe-admit':
      return parseRecipe(command.recipe, presetText, readers.language);
    default:
      return unsupported(command);
  }
}

/** Parses theme text with Templates, and pairs the theme to save with its three fonts. */
function parseTheme(
  themeText: string,
  themeReader: ThemeReader,
): Result<PresetSource> {
  const theme = themeReader.read(themeText);
  if (!theme.ok) {
    return theme;
  }
  return success({ admission: theme.value.admission, resources: theme.value.fonts });
}

/**
 * Stores the fonts and images the preset names, read from beside the preset file, then has the
 * service prepare the preset with their digests. Storing comes first because preparing needs them.
 */
async function preparePreset(
  presetFile: FilePath,
  presetSource: PresetSource,
  dependencies: AdmitDependencies,
): Promise<Result<PreparedPreset>> {
  const staged = await stageResources(presetFile, presetSource.resources, dependencies);
  if (!staged.ok) {
    return staged;
  }
  const assets = listNamedAssetDigests(staged.value);
  const preparation = await dependencies.resources.prepare(presetSource.admission, assets);
  if (!preparation.ok) {
    return preparation;
  }
  return success({ staged: staged.value, preparation: preparation.value });
}

/**
 * Reads the workspace as it is now, builds the save request against it, then keeps and sends it.
 * The service checks again, when it saves, that nothing it read has changed since.
 */
async function sendPreset(
  command: AdmitCommand,
  prepared: PreparedPreset,
  dependencies: AdmitDependencies,
): Promise<Result<string>> {
  const workspaceAnswer = await dependencies.reads.workspace();
  if (!workspaceAnswer.ok) {
    return workspaceAnswer;
  }
  const retained = buildRetainedRequest(
    command,
    prepared,
    workspaceAnswer.value,
    dependencies.requestIds,
  );
  if (!retained.ok) {
    return retained;
  }
  return submitRequest(retained.value, 'apply', dependencies);
}

/**
 * Builds the save request to keep and send: under `--request` or a fresh ID, checked against the
 * workspace as read, with copies of the stored font and image bytes for a retry.
 */
function buildRetainedRequest(
  command: AdmitCommand,
  prepared: PreparedPreset,
  workspaceAnswer: ServiceAnswer<WorkspaceSnapshot>,
  requestIds: RequestIds,
): Result<RetainedRequest> {
  const requestId = chooseRequestId(command, requestIds);
  if (!requestId.ok) {
    return requestId;
  }
  const draft = presetDraft(prepared, requestId.value);
  const request = buildPresetRequest(draft, workspaceAnswer.value);
  if (!request.ok) {
    return request;
  }
  const backups = prepared.staged.map((stagedAsset) => stagedAsset.backup);
  return success({ generation: workspaceAnswer.generation, request: request.value, backups });
}

/** Pairs the prepared preset and its stored fonts and images with the ID the save is sent under. */
function presetDraft(
  prepared: PreparedPreset,
  requestId: RequestId,
): PresetDraft {
  const assets = listNamedAssetDigests(prepared.staged);
  return { preparation: prepared.preparation, assets, request: requestId };
}

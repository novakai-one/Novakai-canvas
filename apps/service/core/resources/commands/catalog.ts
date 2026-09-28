/*
 * Why this file exists
 *
 * Preparing a preset and turning a recipe into DSL start the same way. Both read the themes and
 * recipes stored in the workspace, and both ask the selector which themes and files a preset uses.
 * The selector only reads change requests, so a preset is first wrapped in one. For example, a
 * recipe whose DSL says `theme=paper` is wrapped as a `preset` change carrying that DSL.
 *
 * This file does those shared first steps, reading one snapshot. The wrapped request is never
 * sent or saved.
 */
import type {
  Catalog,
  Json,
  LoweredIntent,
  Request,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capability-types.js';
import type {
  PreparationInput,
  ResourceResult,
} from '../../../contract/records/presets/resource-commands.js';
import { presetHeader, type PresetHeader } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { EMPTY_RESOURCES } from '../../../contract/ports/capabilities.js';
import { CLI_CALLER } from '../../../contract/records/transport/http.js';
import { listLiveRecords } from '../../workspace/records.js';
import { success } from '../../../contract/errors.js';
import { invalidInputFailure } from './refusal.js';

/** What reading the stored catalog needs. */
export interface CatalogDependencies {
  /**
   * Makes a Templates that can use only the themes and files picked for this request. Reading the
   * catalog picks none (`templatesWithoutResources`).
   */
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'readCatalog'>;
}

/**
 * Reads the themes and recipes stored in this snapshot, checked by Templates. Fails with Templates'
 * mistake when a stored one can't be read.
 */
export function readStoredCatalog(
  snapshot: Snapshot,
  dependencies: CatalogDependencies,
): ResourceResult<Catalog> {
  const templates = templatesWithoutResources(dependencies);
  const storedPresets = listStoredPresets(snapshot);
  return templates.readCatalog(storedPresets);
}

/**
 * Wraps a preset in a change request, only so the selector can pick the themes and files it uses.
 * The request names the CLI as its sender, the one caller the preset planner accepts. Fails with
 * `invalid-input` at `resources` when the preset or the request fails its check.
 */
export function buildSelectionRequest(
  input: PreparationInput,
  snapshot: Snapshot,
): ResourceResult<Request> {
  const header = presetHeader.safeParse(input.admission);
  if (!header.success) {
    return invalidInputFailure();
  }
  const draft = draftSelectionRequest(input, header.data, snapshot);
  const request = requestSchema.safeParse(draft);
  if (!request.success) {
    return invalidInputFailure();
  }
  return success(request.data);
}

/**
 * Makes a Templates that can use no themes or files, which is all reading the catalog needs. It
 * comes back typed as the caller's own dependencies declare it. Never fails.
 */
export function templatesWithoutResources<CallerTemplates>(dependencies: {
  templates(resources: ResolvedResources): CallerTemplates;
}): CallerTemplates {
  return dependencies.templates(EMPTY_RESOURCES);
}

/** Lists what each live preset record holds, in snapshot order, for Templates to check. */
function listStoredPresets(snapshot: Snapshot): readonly Json[] {
  const presetRecords = listLiveRecords(snapshot, 'preset');
  return presetRecords.map((record) => record.value);
}

/**
 * Builds the preset change request as plain data; `requestSchema` checks it next. A theme has no
 * DSL, so its `source` is empty.
 */
function draftSelectionRequest(
  input: PreparationInput,
  header: PresetHeader,
  snapshot: Snapshot,
): unknown {
  const recipeSource = header.source ?? '';
  const payload = { admission: input.admission, source: recipeSource };
  return {
    workspace: snapshot.workspace,
    request: 'resource-preparation',
    version: 1,
    actor: CLI_CALLER,
    scope: [],
    expected: [],
    assets: input.assets,
    intent: { kind: 'change', planner: 'preset', payload },
  };
}

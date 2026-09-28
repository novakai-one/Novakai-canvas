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
  /** Gives Templates set up with the themes and files one call picked; reading picks none. */
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
  const records = listLiveRecords(snapshot, 'preset').map((item) => item.value);
  return templates.readCatalog(records);
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
  if (!header.success) return invalidInputFailure();
  const request = requestSchema.safeParse(selectionEnvelope(input, header.data, snapshot));
  if (!request.success) return invalidInputFailure();
  return success(request.data);
}

/**
 * Gives Templates set up with no themes or files, which is all reading the catalog needs. It comes
 * back typed as the caller's own dependencies declare it. Never fails.
 */
export function templatesWithoutResources<CallerTemplates>(dependencies: {
  templates(resources: ResolvedResources): CallerTemplates;
}): CallerTemplates {
  return dependencies.templates(EMPTY_RESOURCES);
}

/**
 * The selection envelope before Authoring's request schema checks it: a preset change carrying the
 * admission and its recipe source (empty for a theme). Never fails.
 */
function selectionEnvelope(
  value: PreparationInput,
  header: PresetHeader,
  snapshot: Snapshot,
): unknown {
  return {
    workspace: snapshot.workspace,
    request: 'resource-preparation',
    version: 1,
    actor: CLI_CALLER,
    scope: [],
    expected: [],
    assets: value.assets,
    intent: {
      kind: 'change',
      planner: 'preset',
      payload: { admission: value.admission, source: header.source ?? '' },
    },
  };
}

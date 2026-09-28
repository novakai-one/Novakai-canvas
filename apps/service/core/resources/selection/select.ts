/*
 * Why this file exists
 *
 * A change can use themes and files. For example, DSL with `theme=paper` and an image of a logo
 * needs the `paper` theme and the logo's stored file. Before planning, the service picks exactly
 * which ones from one snapshot, so every later step sees the same pick. Rendering a saved
 * collection asks a similar question: which stored files does it use, and do they still match?
 *
 * This file builds the selector (`ResourceSelector`) that answers both. Each step answers a
 * `Result` (contract/errors.ts); the first mistake stops the pick. It only reads; Authoring saves.
 */
import type {
  Assets,
  AuthoringResult,
  Catalog,
  Language,
  LoweredIntent,
  Request,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capability-types.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type { ResourceSelection } from '../../../contract/records/planning/selection.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { success } from '../../../contract/errors.js';
import { listLiveRecords } from '../../workspace/records.js';
import { bindAssets } from './asset-bindings.js';
import { checkCollectionFiles } from './collection-check.js';
import { listDigestsToHold, listPresetReads } from './coverage.js';
import { readDeclaredResources, decodeIntent, type Intent } from './intent.js';
import { toResourcesJson } from './pins.js';
import { fromCapability } from './refusal.js';
import { listAvailableThemes, applyFrozenThemes, type Themes } from './themes.js';

/** The capabilities the selector asks, and the shipped presets. Compose passes them in. */
export interface ResourceSelectorDependencies {
  /** Model's check, used on each theme and file binding and on a stored collection. */
  readonly model: Pick<ModelRules, 'validate'>;
  /** The file store, which says whether a file is stored and what its media type is. */
  readonly assets: Pick<Assets, 'resolve'>;
  /** Templates, which reads the stored themes and recipes and finds a theme's latest version. */
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog' | 'read'>;
  /** Language's parser, which reads the themes and files a DSL text declares. */
  readonly language: Pick<Language, 'parse'>;
  /**
   * The shipped themes and recipes. A new workspace's seed request (planner `bootstrap`) picks
   * from these, because none are stored yet.
   */
  readonly builtinPresets: Catalog;
}

/**
 * Builds the selector (see `ResourceSelector`): `select` picks a request's themes and files, and
 * `digestsForCollection` checks a saved collection's. Starts nothing.
 */
export function createResourceSelector(
  dependencies: ResourceSelectorDependencies,
): ResourceSelector {
  return {
    select: (request, snapshot) => select(request, snapshot, dependencies),
    digestsForCollection: (collection, workspace) =>
      checkCollectionFiles(collection, workspace, dependencies),
  };
}

/** The request's decoded intent and the themes it may use. */
interface ChosenThemes {
  readonly intent: Intent;
  readonly themes: Themes;
}

/** Picks the request's themes and files, and lists the files to hold and the records read. */
function select(
  request: Request,
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ResourceSelection> {
  const catalog = readPresets(request, snapshot, dependencies);
  if (!catalog.ok) {
    return catalog;
  }
  const resources = pickResources(request, snapshot, catalog.value, dependencies);
  if (!resources.ok) {
    return resources;
  }
  return describeSelection(request, snapshot, catalog.value, resources.value);
}

/** Reads the shipped presets for a new workspace's seed request, and the stored ones otherwise. */
function readPresets(
  request: Request,
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<Catalog> {
  if (isSeedRequest(request)) {
    return success(dependencies.builtinPresets);
  }
  return readStoredPresets(snapshot, dependencies);
}

/** Has Templates check every stored theme and recipe version, picked or not. */
function readStoredPresets(
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<Catalog> {
  const presetRecords = listLiveRecords(snapshot, 'preset');
  const storedPresets = presetRecords.map((record) => record.value);
  return fromCapability(dependencies.templates.readCatalog(storedPresets));
}

/** Chooses the themes the request may use, then binds the files its own text declares. */
function pickResources(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ResolvedResources> {
  const chosen = chooseThemes(request, catalog, dependencies);
  if (!chosen.ok) {
    return chosen;
  }
  return bindDeclaredFiles(request, snapshot, chosen.value, dependencies);
}

/** Lists the themes the catalog offers, decodes the change, then applies its frozen themes. */
function chooseThemes(
  request: Request,
  catalog: Catalog,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ChosenThemes> {
  const available = listAvailableThemes(catalog, dependencies);
  if (!available.ok) {
    return available;
  }
  // The payload is decoded after the catalog is read, so a broken catalog is reported first.
  const intent = decodeIntent(request);
  if (!intent.ok) {
    return intent;
  }
  return keepFrozenThemes(intent.value, available.value);
}

/** Applies the change's frozen themes, and keeps the decoded change with them. */
function keepFrozenThemes(
  intent: Intent,
  available: Themes,
): AuthoringResult<ChosenThemes> {
  const themes = applyFrozenThemes(intent, available);
  if (!themes.ok) {
    return themes;
  }
  return success({ intent, themes: themes.value });
}

/** Asks Language which files the change's text declares, then binds them next to the themes. */
function bindDeclaredFiles(
  request: Request,
  snapshot: Snapshot,
  chosen: ChosenThemes,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ResolvedResources> {
  const declared = readDeclaredResources(chosen.intent, dependencies);
  if (!declared.ok) {
    return declared;
  }
  const assets = bindAssets(request, declared.value, snapshot, chosen.themes, dependencies);
  if (!assets.ok) {
    return assets;
  }
  return success({ themes: chosen.themes, assets: assets.value });
}

/** Writes the pick as JSON, and lists the files to hold and the preset records read. */
function describeSelection(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  resources: ResolvedResources,
): AuthoringResult<ResourceSelection> {
  const resourcesJson = toResourcesJson(resources);
  if (!resourcesJson.ok) {
    return resourcesJson;
  }
  const fileDigests = listDigestsToHold(request, snapshot, catalog, resources.assets);
  if (!fileDigests.ok) {
    return fileDigests;
  }
  const reads = listPresetReads(snapshot);
  return success({
    resources,
    resourcesJson: resourcesJson.value,
    fileDigests: fileDigests.value,
    reads,
  });
}

/** Whether the request is a new workspace's seed request (planner `bootstrap`). */
function isSeedRequest(request: Request): boolean {
  return request.intent.kind === 'change' && request.intent.planner === 'bootstrap';
}

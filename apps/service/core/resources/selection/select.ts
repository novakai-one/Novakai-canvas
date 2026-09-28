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
import { andThen, success } from '../../../contract/errors.js';
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

/**
 * Resolves theme and asset aliases, the bytes to hold until commit, and the preset records read.
 *
 * Steps; the first failure stops the selection:
 * 1. Read the presets (see `presets`).
 * 2. Choose the themes (see `chooseThemes`).
 * 3. Bind the assets the request declares (see `resolveResources`).
 * 4. Record the pins and the bytes held until commit (see `selection`).
 */
function select(
  request: Request,
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ResourceSelection> {
  const catalog = presets(request, snapshot, dependencies);
  if (!catalog.ok) return catalog;
  const chosen = chooseThemes(request, catalog.value, dependencies);
  if (!chosen.ok) return chosen;
  const resources = resolveResources(request, snapshot, chosen.value, dependencies);
  return andThen(resources, (resolved) => selection(request, snapshot, catalog.value, resolved));
}

/**
 * The themes the catalog offers, then the request's retained pins over them. The payload is
 * decoded after the owner reads, so a broken catalog is still reported before a bad payload.
 * Fails as `listAvailableThemes`, `decodeIntent` or `applyFrozenThemes` fails.
 */
function chooseThemes(
  request: Request,
  catalog: Catalog,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ChosenThemes> {
  const available = listAvailableThemes(catalog, dependencies);
  if (!available.ok) return available;
  const intent = decodeIntent(request);
  if (!intent.ok) return intent;
  const themes = applyFrozenThemes(intent.value, available.value);
  return andThen(themes, (pinned) => success({ intent: intent.value, themes: pinned }));
}

/**
 * The chosen themes and the asset bindings the request's own source declares. Fails as
 * `readDeclaredResources` or `bindAssets` fails.
 */
function resolveResources(
  request: Request,
  snapshot: Snapshot,
  chosen: ChosenThemes,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<ResolvedResources> {
  const declared = readDeclaredResources(chosen.intent, dependencies);
  if (!declared.ok) return declared;
  const assets = bindAssets(request, declared.value, snapshot, chosen.themes, dependencies);
  return andThen(assets, (bound) => success({ themes: chosen.themes, assets: bound }));
}

/**
 * The selection: the resources, their pins as JSON, the bytes held until commit and every preset
 * record read. Fails with `invalid-input` at `resources` when the resources are not JSON or a
 * digest is malformed.
 */
function selection(
  request: Request,
  snapshot: Snapshot,
  catalog: Catalog,
  resources: ResolvedResources,
): AuthoringResult<ResourceSelection> {
  const pins = toResourcesJson(resources);
  if (!pins.ok) return pins;
  const covered = listDigestsToHold(request, snapshot, catalog, resources.assets);
  if (!covered.ok) return covered;
  const reads = listPresetReads(snapshot);
  return success({ resources, resourcesJson: pins.value, fileDigests: covered.value, reads });
}

/** Bootstrap reads the fixed installation presets; every other request reads the stored ones. */
function presets(
  request: Request,
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<Catalog> {
  if (request.intent.kind === 'change' && request.intent.planner === 'bootstrap')
    return success(dependencies.builtinPresets);
  return storedPresets(snapshot, dependencies);
}

/**
 * Templates decodes the whole stored catalog, checking hashes and dependencies of every version,
 * selected or not. Fails with `missing-asset` at `resources` when Templates refuses (its failure
 * kept in `source`).
 */
function storedPresets(
  snapshot: Snapshot,
  dependencies: ResourceSelectorDependencies,
): AuthoringResult<Catalog> {
  return fromCapability(
    dependencies.templates.readCatalog(
      listLiveRecords(snapshot, 'preset').map((item) => item.value),
    ),
  );
}

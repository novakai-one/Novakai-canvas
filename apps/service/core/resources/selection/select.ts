/*
 * Resource selection: the theme and asset bindings one request may use, and whether a collection's
 * pins still match the stored presets and bytes. This file composes the steps (intent, themes,
 * asset-bindings, coverage, collection-check); each step returns its refusal as a value
 * (refusal.ts) and the first one stops the selection. Pure over the injected owners; Authoring
 * owns commit and recovery.
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
import { liveRecords } from '../../workspace/records.js';
import { boundAssets } from './asset-bindings.js';
import { collectionResources } from './collection-check.js';
import { coverage, presetReads } from './coverage.js';
import { declaredResources, decodeIntent, type Intent } from './intent.js';
import { selectionPins } from './pins.js';
import { fromOwner } from './refusal.js';
import { availableThemes, pinnedThemes, type Themes } from './themes.js';

/** The owners selection reads through; compose passes them from ServiceCapabilities and the workspace. */
export interface ResourceOwners {
  readonly model: Pick<ModelRules, 'validate'>;
  readonly assets: Pick<Assets, 'resolve'>;
  readonly templates: Pick<Templates<LoweredIntent>, 'readCatalog' | 'read'>;
  readonly language: Pick<Language, 'parse'>;
  /** The fixed installation presets a bootstrap request reads. */
  readonly installation: Catalog;
}

/**
 * Selects a request's resources and checks a collection's pins; Authoring owns commit and recovery.
 * Refuses with `missing-asset` (owner failure kept in `source`) or `invalid-input` (undecodable payload).
 */
export function createResourceSelector(owners: ResourceOwners): ResourceSelector {
  return {
    select: (request, snapshot) => select(request, snapshot, owners),
    digestsForCollection: (collection, workspace) =>
      collectionResources(collection, workspace, owners),
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
  owners: ResourceOwners,
): AuthoringResult<ResourceSelection> {
  const catalog = presets(request, snapshot, owners);
  if (!catalog.ok) return catalog;
  const chosen = chooseThemes(request, catalog.value, owners);
  if (!chosen.ok) return chosen;
  const resources = resolveResources(request, snapshot, chosen.value, owners);
  return andThen(resources, (resolved) => selection(request, snapshot, catalog.value, resolved));
}

/**
 * The themes the catalog offers, then the request's retained pins over them. The payload is
 * decoded after the owner reads, so a broken catalog is still reported before a bad payload.
 * Fails as `availableThemes`, `decodeIntent` or `pinnedThemes` fails.
 */
function chooseThemes(
  request: Request,
  catalog: Catalog,
  owners: ResourceOwners,
): AuthoringResult<ChosenThemes> {
  const available = availableThemes(catalog, owners);
  if (!available.ok) return available;
  const intent = decodeIntent(request);
  if (!intent.ok) return intent;
  const themes = pinnedThemes(intent.value, available.value);
  return andThen(themes, (pinned) => success({ intent: intent.value, themes: pinned }));
}

/**
 * The chosen themes and the asset bindings the request's own source declares. Fails as
 * `declaredResources` or `boundAssets` fails.
 */
function resolveResources(
  request: Request,
  snapshot: Snapshot,
  chosen: ChosenThemes,
  owners: ResourceOwners,
): AuthoringResult<ResolvedResources> {
  const declared = declaredResources(chosen.intent, owners);
  if (!declared.ok) return declared;
  const assets = boundAssets(request, declared.value, snapshot, chosen.themes, owners);
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
  const pins = selectionPins(resources);
  if (!pins.ok) return pins;
  const covered = coverage(request, snapshot, catalog, resources.assets);
  if (!covered.ok) return covered;
  const reads = presetReads(snapshot);
  return success({ resources, resourcesJson: pins.value, fileDigests: covered.value, reads });
}

/** Bootstrap reads the fixed installation presets; every other request reads the stored ones. */
function presets(
  request: Request,
  snapshot: Snapshot,
  owners: ResourceOwners,
): AuthoringResult<Catalog> {
  if (request.intent.kind === 'change' && request.intent.planner === 'bootstrap')
    return success(owners.installation);
  return storedPresets(snapshot, owners);
}

/**
 * Templates decodes the whole stored catalog, checking hashes and dependencies of every version,
 * selected or not. Fails with `missing-asset` at `resources` when Templates refuses (its failure
 * kept in `source`).
 */
function storedPresets(
  snapshot: Snapshot,
  owners: ResourceOwners,
): AuthoringResult<Catalog> {
  return fromOwner(
    owners.templates.readCatalog(liveRecords(snapshot, 'preset').map((item) => item.value)),
  );
}

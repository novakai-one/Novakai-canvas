/*
 * Resource selection: the theme and asset bindings one request may use, and whether a collection's
 * pins still match the stored presets and bytes. This file composes the steps (intent, themes,
 * asset-bindings, coverage, collection-check) and is the only one that turns a refusal into a
 * typed failure. Pure over the injected owners; Authoring owns commit and recovery.
 */
import type {
  Assets,
  Catalog,
  Language,
  LoweredIntent,
  Request,
  Snapshot,
  Templates,
} from '../../../contract/records/capabilities.js';
import type { ModelRules } from '../../../contract/ports/capabilities.js';
import type { ResourceSelection } from '../../../contract/records/planning/selection.js';
import type { ResourceSelector } from '../../../contract/ports/workspace.js';
import { json } from '../../../contract/schemas.js';
import { liveRecords } from '../../workspace/records.js';
import { boundAssets } from './asset-bindings.js';
import { collectionResources } from './collection-check.js';
import { coverage, presetReads } from './coverage.js';
import { declaredResources, decodeIntent } from './intent.js';
import { accepted, guarded } from './refusal.js';
import { availableThemes, pinnedThemes } from './themes.js';

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
    select: (request, snapshot) => guarded(() => select(request, snapshot, owners)),
    forCollection: (collection, workspace) =>
      guarded(() => collectionResources(collection, workspace, owners)),
  };
}

/** Resolves theme and asset aliases, the bytes to hold until commit, and the preset records read. */
function select(
  request: Request,
  snapshot: Snapshot,
  owners: ResourceOwners,
): ResourceSelection {
  const catalog = presets(request, snapshot, owners);
  const available = availableThemes(catalog, owners);
  // Decoded after the owner reads, so a broken catalog is still reported before a bad payload.
  const intent = decodeIntent(request);
  const resolvedThemes = pinnedThemes(intent, available);
  const declared = declaredResources(intent, owners);
  const resources = {
    themes: resolvedThemes,
    assets: boundAssets(request, declared, snapshot, resolvedThemes, owners),
  };
  return {
    resources,
    pins: json.parse({ resources }),
    covered: coverage(request, snapshot, catalog, resources.assets),
    reads: presetReads(snapshot),
  };
}

/** Bootstrap reads the fixed installation presets; every other request reads the stored ones. */
function presets(
  request: Request,
  snapshot: Snapshot,
  owners: ResourceOwners,
): Catalog {
  if (request.intent.kind === 'change' && request.intent.planner === 'bootstrap')
    return owners.installation;
  return storedPresets(snapshot, owners);
}

/** Templates decodes the whole stored catalog, checking hashes and dependencies of every version, selected or not. */
function storedPresets(
  snapshot: Snapshot,
  owners: ResourceOwners,
): Catalog {
  return accepted(
    owners.templates.readCatalog(liveRecords(snapshot, 'preset').map((item) => item.value)),
  );
}

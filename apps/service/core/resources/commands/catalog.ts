/*
 * What a resource command reads first: the stored preset catalog, decoded by Templates against one
 * exact snapshot, and the semantic selection envelope the selector reads. Pure over Templates; an
 * owner refusal throws PreparationFault and a malformed admission throws zod's error (`guarded` in
 * refusal.ts turns both into a ResourceResult). Authoring owns commit and recovery.
 */
import type {
  Catalog,
  LoweredIntent,
  Request,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capabilities.js';
import type { PreparationInput } from '../../../contract/records/presets/preparation.js';
import { presetAdmission } from '../../../contract/records/planning/commands.js';
import { requestSchema } from '../../../contract/schemas.js';
import { EMPTY_RESOURCES } from '../../../contract/ports/capabilities.js';
import { CLI_CALLER } from '../../../contract/records/transport/http.js';
import { liveRecords } from '../../workspace/records.js';
import { accepted } from './refusal.js';

/** The owner catalog reads go through. */
export interface CatalogOwners {
  /** Templates bound to one call's resolved resources; catalog reads bind none. */
  templates(resources: ResolvedResources): Pick<Templates<LoweredIntent>, 'readCatalog'>;
}

/**
 * Reads catalog records through Templates against the exact supplied snapshot. Throws
 * PreparationFault with the Templates diagnostic when a stored preset does not decode.
 */
export function storedCatalog(
  snapshot: Snapshot,
  owners: CatalogOwners,
): Catalog {
  const templates = unboundTemplates(owners);
  const records = liveRecords(snapshot, 'preset').map((item) => item.value);
  return accepted(templates.readCatalog(records));
}

/**
 * Builds only a semantic selection envelope, never a persistence transaction or canonical binding.
 * The actor is the CLI caller, the one caller that may address the preset planner. Throws zod's
 * error when the admission header or the envelope does not parse.
 */
export function selectionRequest(
  value: PreparationInput,
  snapshot: Snapshot,
): Request {
  const header = presetAdmission.parse(value.admission);
  return requestSchema.parse({
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
  });
}

/**
 * Catalog reads need no selected resources. Returns Templates bound to none, typed as the caller's
 * own owner bag declares them. Never refuses.
 */
export function unboundTemplates<Bound>(owners: {
  templates(resources: ResolvedResources): Bound;
}): Bound {
  return owners.templates(EMPTY_RESOURCES);
}

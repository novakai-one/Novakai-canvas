/*
 * Preset preparation: a theme or recipe admission normalised, bound to its selected resources and
 * planned by Templates against one snapshot, without a canonical write. Pure over the injected
 * owners; a refusal throws PreparationFault or zod's error (`guarded` in refusal.ts turns both
 * into a ResourceResult), and Authoring owns the canonical write and receipt.
 */
import type {
  Catalog,
  Json,
  LoweredIntent,
  Preset,
  ResolvedResources,
  Snapshot,
  Templates,
} from '../../../contract/records/capabilities.js';
import type {
  PresetPreparation,
  ResourceResult,
} from '../../../contract/records/presets/preparation.js';
import {
  admissionFields,
  preparationInput,
} from '../../../contract/records/presets/preparation.js';
import type { ResourceSelector } from '../../../contract/records/planning/planning.js';
import { json, recordId } from '../../../contract/schemas.js';
import { selectionRequest, storedCatalog } from './catalog.js';
import { accepted } from './refusal.js';

/** The owners preparation works through. */
export interface PreparationOwners {
  readonly selector: Pick<ResourceSelector, 'select'>;
  /** Normalises a theme admission against the catalog and the uploaded font bindings. */
  normalize(
    admission: Json,
    catalog: Catalog,
    assets: readonly { readonly alias: string; readonly digest: string }[],
  ): ResourceResult<Json>;
  /** Templates bound to one call's resolved resources. */
  templates(
    resources: ResolvedResources,
  ): Pick<Templates<LoweredIntent>, 'readCatalog' | 'planAdmission' | 'read'>;
}

/**
 * Preparation binds codecs to selected resources; no catalog or workspace state is mutated.
 * Throws zod's error for a malformed input, and PreparationFault with the owner's diagnostic when
 * Templates, theme normalisation or the selector refuses.
 */
export function prepare(
  raw: unknown,
  snapshot: Snapshot,
  owners: PreparationOwners,
): PresetPreparation {
  const value = preparationInput.parse(raw);
  const records = storedCatalog(snapshot, owners);
  const admission = json.parse(accepted(owners.normalize(value.admission, records, value.assets)));
  const selected = accepted(
    owners.selector.select(selectionRequest({ ...value, admission }, snapshot), snapshot),
  );
  const templates = owners.templates(selected.resources);
  const plan = accepted(templates.planAdmission(records, admission));
  const preset = accepted(templates.read(plan.candidate, plan.pin));
  return {
    admission: normalizedAdmission(admission, preset),
    record: json.parse(preset),
    pin: plan.pin,
    key: { kind: 'preset', id: recordId.parse(`preset:${plan.pin.digest}`) },
    resources: preset.kind === 'theme' ? preset.payload.fonts : preset.payload.assets,
    reads: snapshot.records
      .filter((item) => ['preset', 'workspace'].includes(item.key.kind))
      .map((item) => ({ key: item.key, version: item.version })),
  };
}

/** Canonical recipe printing freezes theme aliases and local media declarations before returning a retained admission. */
function normalizedAdmission(
  admission: PresetPreparation['admission'],
  preset: Preset,
): PresetPreparation['admission'] {
  if (preset.kind !== 'recipe') return admission;
  const original = admissionFields.parse(admission);
  return { ...original, source: preset.payload.source };
}
